const http = require('http');
http.get('http://localhost:3502/api/submissions/d0dde392-62d3-4aa2-b83e-14f931b9441b/analysis', (res) => {
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => console.log(data));
});
