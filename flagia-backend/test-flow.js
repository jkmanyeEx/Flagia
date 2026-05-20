const http = require('http');

const request = (method, path, body, token) => {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: '/api' + path,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };
    if (token) {
      options.headers['Authorization'] = 'Bearer ' + token;
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
};

(async () => {
  try {
    const ts = Date.now();
    console.log("1. Registering Teacher...");
    const teacherReg = await request('POST', '/auth/register', {
      email: `teacher${ts}@test.com`,
      password: 'password123',
      name: 'Test Teacher',
      role: 'TEACHER'
    });
    console.log(teacherReg);
    const teacherToken = teacherReg.body.token;

    console.log("\n2. Creating Assignment...");
    const createRes = await request('POST', '/assignments', {
      title: 'Test Assignment ' + ts,
      mode: 'STANDARD',
      dueDate: new Date(Date.now() + 86400000).toISOString(),
      timeLimit: 60,
      textLimit: 3000,
      templateText: 'Write about tests'
    }, teacherToken);
    console.log(createRes);
    const joinCode = createRes.body.join_code;
    console.log("Join Code:", joinCode);

    console.log("\n3. Registering Student...");
    const studentReg = await request('POST', '/auth/register', {
      email: `student${ts}@test.com`,
      password: 'password123',
      name: 'Test Student',
      role: 'STUDENT'
    });
    console.log(studentReg);
    const studentToken = studentReg.body.token;

    console.log("\n4. Checking Join Code...");
    const lookupRes = await request('GET', '/assignments/join/' + joinCode, null, studentToken);
    console.log(lookupRes);

    console.log("\n5. Joining Assignment...");
    const joinRes = await request('POST', '/assignments/join/' + joinCode, null, studentToken);
    console.log(joinRes);

    console.log("\n6. Fetching Student Assignments...");
    const studentList = await request('GET', '/assignments', null, studentToken);
    console.log(studentList.body.length, "assignments found");
    if (studentList.body.length > 0) {
      console.log("First assignment:", studentList.body[0].title);
    }

  } catch (err) {
    console.error(err);
  }
})();
