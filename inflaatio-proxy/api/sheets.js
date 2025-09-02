// api/sheets.js - Vercel serverless function
import cors from 'cors';

// Initialize CORS
const corsOptions = {
  origin: [
    'https://jannejok.github.io',
    'http://localhost:3000',
    'http://127.0.0.1:5500' // VS Code Live Server
  ],
  methods: ['GET'],
  credentials: false
};

function runMiddleware(req, res, fn) {
  return new Promise((resolve, reject) => {
    fn(req, res, (result) => {
      if (result instanceof Error) {
        return reject(result);
      }
      return resolve(result);
    });
  });
}

export default async function handler(req, res) {
  // Run CORS middleware
  await runMiddleware(req, res, cors(corsOptions));

  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { range } = req.query;
    
    // Validate range parameter
    const allowedRanges = ['Raakadata!A:F', 'Key Metrics!A:B'];
    if (!range || !allowedRanges.includes(range)) {
      return res.status(400).json({ 
        error: 'Invalid range parameter',
        allowedRanges 
      });
    }

    // Your Google Sheets configuration
    const SHEET_ID = '1tj7AbW3BkzmPZUd_pfrXmaHZrgpKgYwNljSoVoAObx8';
    const API_KEY = process.env.GOOGLE_SHEETS_API_KEY;

    if (!API_KEY) {
      return res.status(500).json({ error: 'API key not configured' });
    }

    // Build Google Sheets API URL
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}?key=${API_KEY}`;

    // Fetch data from Google Sheets
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Google Sheets API error: ${response.status}`);
    }

    const data = await response.json();

    // Add cache headers (cache for 5 minutes)
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
    
    // Return the data
    return res.status(200).json({
      success: true,
      data: data.values || [],
      range: range,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Sheets API Error:', error);
    return res.status(500).json({ 
      error: 'Failed to fetch data',
      message: error.message 
    });
  }
}