import { initWebSocket } from './src/websocket/websocket';
import express from 'express';
import fileUpload from 'express-fileupload';
import http from 'http';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import AuthMiddleware from './src/middlewares/auth-middleware'; 
import AuthRouter from './src/controllers/auth/router';
import DialogsRouter from './src/controllers/dialogs/router';

require('dotenv').config();

const PORT = process.env.PORT;
const app = express();
const server = http.createServer(app);

app.use(cors({ 
    origin: 'http://localhost:3000',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'], 
    credentials: true 
}));
app.use(cookieParser());
app.use(AuthMiddleware as express.RequestHandler);

app.use(fileUpload({ createParentPath: true }));
app.use(express.json());
app.use(express.static('./static'));
app.use(express.urlencoded({ extended: true }));

app.use("/auth", AuthRouter);
app.use("/dialogs", DialogsRouter);

initWebSocket(server);

async function startApp() {
    try {
        server.listen(PORT, () => console.log('Server started at PORT' + " " + PORT));
    } catch (error) {
        console.error(error);
    }
}

startApp();
