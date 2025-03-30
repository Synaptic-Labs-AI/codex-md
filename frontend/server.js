import { handler } from './build/handler.js';
import express from 'express';

const app = express();
const port = process.env.PORT || 3000; // Railway will provide PORT

app.use(handler);

app.listen(port, '0.0.0.0', () => {
  console.log(`Server listening on port ${port}`);
});
