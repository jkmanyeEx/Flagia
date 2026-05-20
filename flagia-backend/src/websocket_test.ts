import WebSocket from 'ws';

const API_URL = 'http://localhost:3000';
const WS_URL = 'ws://localhost:3000/ws';

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTest() {
  console.log('🚀 Starting Flagia WebSocket Integration Test...');

  // 1. Register test users
  const timestamp = Date.now();
  const teacherEmail = `teacher_${timestamp}@test.com`;
  const studentEmail = `student_${timestamp}@test.com`;

  console.log(`- Registering teacher: ${teacherEmail}`);
  const teacherRegRes = await fetch(`${API_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Test Teacher',
      email: teacherEmail,
      password: 'password123',
      role: 'TEACHER'
    })
  });
  if (!teacherRegRes.ok) {
    throw new Error(`Teacher registration failed: ${await teacherRegRes.text()}`);
  }
  const teacherData = await teacherRegRes.json() as any;
  const teacherToken = teacherData.token;
  console.log('✓ Teacher registered successfully.');

  console.log(`- Registering student: ${studentEmail}`);
  const studentRegRes = await fetch(`${API_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Test Student',
      email: studentEmail,
      password: 'password123',
      role: 'STUDENT'
    })
  });
  if (!studentRegRes.ok) {
    throw new Error(`Student registration failed: ${await studentRegRes.text()}`);
  }
  const studentData = await studentRegRes.json() as any;
  const studentToken = studentData.token;
  console.log('✓ Student registered successfully.');

  // 2. Establish WS connection for Teacher
  console.log('- Connecting Teacher to WebSocket...');
  const teacherWs = new WebSocket(WS_URL);
  let teacherMessages: any[] = [];

  teacherWs.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    console.log('[Teacher WS Received]:', msg);
    teacherMessages.push(msg);
  });

  await new Promise((resolve) => teacherWs.on('open', resolve));
  teacherWs.send(JSON.stringify({
    type: 'auth',
    payload: { token: teacherToken }
  }));
  await delay(1000); // wait for auth_ok

  // 3. Establish WS connection for Student
  console.log('- Connecting Student to WebSocket...');
  const studentWs = new WebSocket(WS_URL);
  let studentMessages: any[] = [];

  studentWs.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    console.log('[Student WS Received]:', msg);
    studentMessages.push(msg);
  });

  await new Promise((resolve) => studentWs.on('open', resolve));
  studentWs.send(JSON.stringify({
    type: 'auth',
    payload: { token: studentToken }
  }));
  await delay(1000); // wait for auth_ok

  // 4. Create an assignment (Teacher)
  console.log('- Teacher creating assignment...');
  const assignmentRes = await fetch(`${API_URL}/api/assignments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${teacherToken}`
    },
    body: JSON.stringify({
      title: `WS Test Assignment ${timestamp}`,
      dueDate: new Date(Date.now() + 86400000).toISOString(),
      timeLimit: 60,
      textLimit: 2000,
      templateText: 'Write something.',
      mode: 'STANDARD'
    })
  });
  if (!assignmentRes.ok) {
    throw new Error(`Assignment creation failed: ${await assignmentRes.text()}`);
  }
  const assignment = await assignmentRes.json() as any;
  console.log(`✓ Assignment created: ${assignment.id}`);

  // Wait to see if Student received assignments_update
  await delay(1500);
  const foundAssignmentsUpdate = studentMessages.some(m => m.type === 'assignments_update');
  if (foundAssignmentsUpdate) {
    console.log('🎉 SUCCESS: Student received "assignments_update" real-time broadcast!');
  } else {
    throw new Error('FAILED: Student did not receive "assignments_update"');
  }

  // 5. Teacher joins the room for this assignment
  console.log('- Teacher subscribing to updates for this assignment...');
  teacherWs.send(JSON.stringify({
    type: 'teacher_join',
    payload: { assignmentId: assignment.id }
  }));
  await delay(500);

  // 6. Student creates/joins a submission session
  console.log('- Student starting submission...');
  const subRes = await fetch(`${API_URL}/api/submissions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${studentToken}`
    },
    body: JSON.stringify({ assignmentId: assignment.id })
  });
  if (!subRes.ok) {
    throw new Error(`Submission creation failed: ${await subRes.text()}`);
  }
  const submission = await subRes.json() as any;
  console.log(`✓ Submission created: ${submission.id}`);

  console.log('- Student joining writing session...');
  studentWs.send(JSON.stringify({
    type: 'join_session',
    payload: { submissionId: submission.id, assignmentId: assignment.id }
  }));

  // Wait to see if Teacher received submissions_update
  await delay(1500);
  let foundSubmissionsUpdate = teacherMessages.some(
    m => m.type === 'submissions_update' && m.payload.assignmentId === assignment.id
  );
  if (foundSubmissionsUpdate) {
    console.log('🎉 SUCCESS: Teacher received "submissions_update" on Student session join!');
  } else {
    throw new Error('FAILED: Teacher did not receive "submissions_update" on join');
  }

  // Clear message arrays to check submission finalization
  teacherMessages = [];

  // 7. Student submits the assignment
  console.log('- Student finalizing and submitting assignment...');
  const submitRes = await fetch(`${API_URL}/api/submissions/${submission.id}/submit`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${studentToken}`
    },
    body: JSON.stringify({
      finalMarkdown: 'This is the final text written by the student.',
      forceClose: false
    })
  });
  if (!submitRes.ok) {
    throw new Error(`Submission failed: ${await submitRes.text()}`);
  }
  console.log('✓ Submission finalized.');

  // Wait to see if Teacher received submissions_update again
  await delay(1500);
  foundSubmissionsUpdate = teacherMessages.some(
    m => m.type === 'submissions_update' && m.payload.assignmentId === assignment.id
  );
  if (foundSubmissionsUpdate) {
    console.log('🎉 SUCCESS: Teacher received "submissions_update" on Student final submission!');
  } else {
    throw new Error('FAILED: Teacher did not receive "submissions_update" on final submit');
  }

  // 8. Clean up connections
  teacherWs.close();
  studentWs.close();
  console.log('✨ All tests passed successfully!');
}

runTest().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
