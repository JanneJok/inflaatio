const https = require('https');

const SHEET_ID = '1tj7AbW3BkzmPZUd_pfrXmaHZrgpKgYwNljSoVoAObx8';
const RANGE = 'Key Metrics!A:B';
const API_KEY = 'AIzaSyDbeAW-uO-vEHuPdSJPVQwR_l1Axc7Cq7g';
const API_URL = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${RANGE}?key=${API_KEY}`;

https.get(API_URL, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
        const json = JSON.parse(data);
        console.log('Key Metrics data:');
        console.log(JSON.stringify(json.values, null, 2));
    });
});
