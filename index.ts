import { initWebSocket } from './src/websocket/websocket';
import { checkFileAccess } from './src/middlewares/static-middleware';
import express from 'express';
import fileUpload from 'express-fileupload';
import http from 'http';
import cors from 'cors';
import path from 'path';
import cookieParser from 'cookie-parser';
import AuthMiddleware from './src/middlewares/auth-middleware'; 
import AuthRouter from './src/controllers/auth/router';
import DialogsRouter from './src/controllers/dialogs/router';
import UsersRouter from './src/controllers/users/router';

require('dotenv').config();

const PORT = process.env.PORT;
const app = express();
const server = http.createServer(app);

app.use(cors({ 
    origin: 'http://localhost:5173',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'], 
    credentials: true 
}));
app.use(cookieParser());
app.use(AuthMiddleware as express.RequestHandler);

app.use(fileUpload({ createParentPath: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Публичная статика (без проверки)
app.use('/files', express.static(path.join(__dirname, 'static/files')));

// Защищённая статика – файлы диалогов
app.get('/dialogs-files/:dialogId/:filename', checkFileAccess, (req, res) => {
    const { dialogId, filename } = req.params;
    const filePath = path.join(__dirname, 'static', 'dialogs-files', dialogId, filename);
    res.sendFile(filePath, (err) => {
        if (err) {
            res.status(404).send('File not found');
        }
    });
});

app.use("/auth", AuthRouter);
app.use("/dialogs", DialogsRouter);
app.use("/users", UsersRouter);

initWebSocket(server);

async function startApp() {
    try {
        server.listen(PORT, () => console.log('Server started at PORT' + " " + PORT));
    } catch (error) {
        console.error(error);
    }
}

startApp();
