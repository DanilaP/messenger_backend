import { Request } from 'express';
import jwt, { JwtPayload } from "jsonwebtoken";
import * as ws from 'ws';

let socketserver: ws.Server;
let clients: { userws: ws, userId: string }[] = [];

export const initWebSocket = (server: any) => {
    socketserver = new ws.Server({ 
        server,
        verifyClient: (info, done) => {
            done(true);
        }
    });
    
    socketserver.on('connection', (ws: ws, request: Request) => {
        try {
            const authToken = request.headers.cookie as string; 

            if (!authToken) {
                throw new Error('Токен не найден в куках');
            }

            const userId = (jwt.decode(authToken) as JwtPayload).id.toString();
            clients = [...clients, { userws: ws, userId }];
            console.log(`Пользователь ${userId} подключен`);

            ws.on('close', () => {
                clients = clients.filter(client => client.userws !== ws);
                console.log(`Пользователь ${userId} отключился`);
            });

            ws.on('error', (error) => {
                console.error(`Ошибка соединения для пользователя ${userId}:`, error);
            });
            
        } catch (error) {
            console.error("Ошибка при подключении WebSocket:", error);
            ws.close(1008, 'Не авторизован');
        }
    });
};

export const broadcastMessage = (recipientIds: string[], message: any) => {
    const messageString = JSON.stringify(message);
    
    clients.forEach(client => {
        if (recipientIds.includes(client.userId) && client.userws.readyState === ws.OPEN) {
            try {
                client.userws.send(messageString);
            } catch (error) {
                console.error("Ошибка при отправке сообщения через WebSocket", error);
            }
        }
    });
};