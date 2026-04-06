const WebSocket = require('ws');
const robot = require('robotjs');

// Configuration – must be provided via environment variables
const SERVER_URL = process.env.SERVER_URL || 'ws://localhost:2567';
const OWNER_SESSION_ID = process.env.OWNER_SESSION_ID; // your Colyseus session ID

if (!OWNER_SESSION_ID) {
  console.error('❌ Please set OWNER_SESSION_ID environment variable');
  process.exit(1);
}

const ws = new WebSocket(SERVER_URL);

ws.on('open', () => {
  console.log('✅ Connected to server');
  // Register as agent for this owner
  ws.send(JSON.stringify({ type: 'register_agent', ownerId: OWNER_SESSION_ID }));
});

ws.on('message', (data) => {
  try {
    const msg = JSON.parse(data);
    // Server will send 'input_event' messages
    if (msg.type === 'input_event') {
      handleInputEvent(msg.event);
    }
  } catch (err) {
    console.error('❌ Failed to parse message', err);
  }
});

ws.on('close', () => {
  console.log('❌ Disconnected from server');
});

ws.on('error', (err) => {
  console.error('❌ WebSocket error', err);
});

function handleInputEvent(event) {
  console.log('📥 Received input event:', event);
  const screen = robot.getScreenSize();

  switch (event.type) {
    case 'mousemove':
      // event.x, event.y are normalized 0–1
      const x = event.x * screen.width;
      const y = event.y * screen.height;
      robot.moveMouse(x, y);
      break;

    case 'mousedown':
      robot.mouseToggle('down', event.button === 0 ? 'left' : 'right');
      break;

    case 'mouseup':
      robot.mouseToggle('up');
      break;

    case 'wheel':
      // Approximate scroll
      robot.scrollMouse(event.deltaY / 100, event.deltaX / 100);
      break;

    case 'keydown':
      robot.keyToggle(event.key, 'down');
      break;

    case 'keyup':
      robot.keyToggle(event.key, 'up');
      break;

    default:
      console.warn('⚠️ Unknown event type', event.type);
  }
}