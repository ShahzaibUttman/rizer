// api/upload.js — Vercel serverless proxy for monday.com file uploads
// Needed because browser CORS blocks direct POST to api.monday.com/v2/file

export const config = {
  api: { bodyParser: false },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // Collect raw body
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const rawBody = Buffer.concat(chunks);
    const contentType = req.headers['content-type'] || '';

    // Parse multipart manually using busboy
    const busboy = (await import('busboy')).default;
    const FormData = (await import('form-data')).default;

    const fields = {};
    let fileBuffer = null, fileName = 'upload', fileMime = 'application/octet-stream';

    await new Promise((resolve, reject) => {
      const bb = busboy({ headers: { 'content-type': contentType } });
      bb.on('field', (k, v) => { fields[k] = v; });
      bb.on('file', (_field, stream, info) => {
        fileName = info.filename || 'upload';
        fileMime = info.mimeType || 'application/octet-stream';
        const bufs = [];
        stream.on('data', d => bufs.push(d));
        stream.on('end', () => { fileBuffer = Buffer.concat(bufs); });
      });
      bb.on('finish', resolve);
      bb.on('error', reject);
      bb.end(rawBody);
    });

    const { itemId, columnId, token } = fields;
    if (!itemId || !columnId || !token || !fileBuffer) {
      return res.status(400).json({ error: 'Missing: itemId, columnId, token, or file' });
    }

    // Forward to monday.com file API (server-side — no CORS)
    const form = new FormData();
    form.append('query', `mutation ($file: File!) { add_file_to_column(item_id: ${itemId}, column_id: "${columnId}", file: $file) { id } }`);
    form.append('variables[file]', fileBuffer, { filename: fileName, contentType: fileMime });

    const mondayRes = await fetch('https://api.monday.com/v2/file', {
      method: 'POST',
      headers: { 'Authorization': token, ...form.getHeaders() },
      body: form.getBuffer(),
    });

    const data = await mondayRes.json();
    if (data.errors) return res.status(400).json({ error: data.errors[0].message });
    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('Upload proxy error:', err);
    return res.status(500).json({ error: err.message });
  }
}
