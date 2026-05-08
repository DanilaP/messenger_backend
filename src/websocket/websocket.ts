import { Request } from 'express';
import jwt, { JwtPayload } from "jsonwebtoken";
import cron from 'node-cron';
import * as ws from 'ws';

let socketserver: ws.Server;
let clients: { userws: ws, userId: number }[] = [];

const broadcastConnectedClients = () => {
    const connectedUserIds = clients.map(client => client.userId);
    const message = JSON.stringify({
        type: 'connected_clients',
        clientIds: connectedUserIds
    });
    clients.forEach(client => {
        if (client.userws.readyState === ws.OPEN) {
            try {
                client.userws.send(message);
            } catch (error) {
                console.error(`Ошибка отправки списка клиентов пользователю ${client.userId}:`, error);
            }
        }
    });
};

function getCookie(cookieString: string, name: string): string | null {
    const cookies = cookieString.split('; ');
    for (const cookie of cookies) {
        const [key, value] = cookie.split('=');
        if (key === name) {
            return value;
        }
    }
    return null;
}

export const initWebSocket = (server: any) => {
    socketserver = new ws.Server({ 
        server,
        verifyClient: (info, done) => {
            done(true);
        }
    });
    
    socketserver.on('connection', (ws: ws, request: Request) => {
        try {
            const cookieHeader = request.headers.cookie as string;
            
            if (!cookieHeader) {
                throw new Error('Куки не найдены');
            }

            const token = getCookie(cookieHeader, 'token');
            if (!token) {
                throw new Error('Токен не найден в куках');
            }

            const payload = jwt.verify(token, process.env.JWT_SECRET!) as JwtPayload;
            const userId = Number(payload.id);

            clients = [...clients, { userws: ws, userId }];

            ws.on('close', () => {
                clients = clients.filter(client => client.userws !== ws);
            });

            ws.on('error', (error) => {
                console.error(`Ошибка соединения для пользователя ${userId}:`, error);
            });
            
        } catch (error) {
            console.error("Ошибка при подключении WebSocket:", error);
            ws.close(1008, 'Не авторизован');
        }
    });

    cron.schedule('*/5 * * * *', () => {
        broadcastConnectedClients();
    });
};

export const broadcastMessage = (recipientIds: number[], message: any) => {
    const modifiedRecipientsIds = recipientIds.map(id => Number(id));
    const messageString = JSON.stringify(message);

    clients.forEach(client => {
        if (modifiedRecipientsIds.includes(client.userId) && client.userws.readyState === ws.OPEN) {
            try {
                client.userws.send(messageString);
            } catch (error) {
                console.error("Ошибка при отправке сообщения через WebSocket", error);
            }
        }
    });
};