import { Request, Response } from 'express';
import { db } from '../../models/db';
import { IMessage } from '../../models/messages/messages';
import { IDialogs } from '../../models/dialogs/dialogs';
import { insertFiles } from '../../models/files/model-helpers';
import { insertDialogMembers } from '../../models/dialogs-members/model-helpers';
import jwt, { JwtPayload } from "jsonwebtoken";
import moment from 'moment';
import fsHelpers from '../../helpers/fs-helpers';

require('dotenv').config();

class DialogsController {
    static async sendMessage(req: Request, res: Response) {
        const client = await db.getClient();

        try {
            await client.query('BEGIN');

            const { text, dialogId, opponentId } = req.body;
            const payload = jwt.verify(req.cookies?.token, process.env.JWT_SECRET!) as JwtPayload;
            const userId = payload.id.toString();

            if ((text || req.files) && (opponentId || dialogId) && opponentId !== userId) {
                const message = {
                    text: text || "",
                    date: moment(Date.now()).format('DD:MM:YYYY HH:mm:ss'),
                    dialog_id: Number(dialogId) || "",
                    sender_id: Number(userId),
                    files: req.files ? (await fsHelpers.uploadFiles(req.files)).filelist : []
                };

                //Если dialogId не передали
                if (!dialogId) {
                    //Проверяем что оппоннет существует
                    const opponentCheck = await client.query<{ id: number }>(
                        'SELECT id FROM users WHERE id = $1',
                        [opponentId]
                    );
                    if (opponentCheck.rows.length === 0) {
                        await client.query('ROLLBACK');
                        res.status(400).json({ message: "Указанный оппонент не существует" });
                        return
                    }

                    // Проверяем, существует ли уже диалог между пользователями
                    const existingDialog = await client.query<{ dialog_id: number }>(
                        `SELECT dm1.dialog_id
                        FROM dialogs_members dm1
                        JOIN dialogs_members dm2 ON dm1.dialog_id = dm2.dialog_id
                        WHERE dm1.user_id = $1 AND dm2.user_id = $2`,
                        [userId, opponentId]
                    );

                    if (existingDialog.rows.length > 0) {
                        // Диалог уже есть - используем его id
                        message.dialog_id = existingDialog.rows[0].dialog_id;
                    } 

                    else {
                        //Добавляем в бд диалог
                        const createdDialog = await client.query<IDialogs>(
                            'INSERT INTO dialogs DEFAULT VALUES RETURNING id'
                        );

                        if (!createdDialog.rows[0].id) {
                            await client.query('ROLLBACK');
                            res.status(500).json({ message: "Ошибка при отправке сообщения. Ошибка при создании диалога" });
                            return;
                        }

                        //Добавляем участников диалога в бд
                        const createdMembers = await insertDialogMembers(client, createdDialog.rows[0].id, [userId, opponentId]);

                        if (createdMembers.length === 0) {
                            await client.query('ROLLBACK');
                            res.status(500).json({ 
                                message: "Ошибка при отправке сообщения. Ошибка при добавлении оппонента в диалог" 
                            });
                            return;
                        }

                        message.dialog_id = createdDialog.rows[0].id;
                    }
                }
                else {
                    //Проверяем что пользователь участник диалога
                    const memberCheck = await client.query(
                        'SELECT * FROM dialogs_members WHERE dialog_id = $1 AND user_id = $2 FOR UPDATE',
                        [Number(dialogId), Number(userId)]
                    );
                    if (memberCheck.rowCount === 0) {
                        await client.query('ROLLBACK');
                        res.status(403).json({ message: "Вы не являетесь участником этого диалога" });
                        return
                    }
                }
                
                //Добавляем в бд сообщение
                const createdMessage = await client.query<IMessage>(
                    `INSERT INTO messages (text, date, dialog_id, sender_id) 
                    VALUES ($1, $2, $3, $4) 
                    RETURNING id, text, date, dialog_id, sender_id`,
                    [text, message.date, Number(message.dialog_id), Number(message.sender_id)]
                );

                if (createdMessage.rows.length === 0) {
                    await client.query('ROLLBACK');
                    res.status(500).json({ message: "Ошибка при отправке сообщения. Ошибка сохранения сообщения" });
                    return;
                }

                //Если файлы переданы - создаем файлы в бд
                if (message.files.length > 0) {
                    const modifiedFiles = message.files.map(file => { 
                        return {
                            ...file, 
                            message_id: createdMessage.rows[0].id
                        }
                    });
                    const createdFiles = await insertFiles(client, modifiedFiles);
                    
                    if (createdFiles.length === 0) {
                        await client.query('ROLLBACK');
                        res.status(400).json({ message: "Ошибка при отправке сообщения. Ошибка при сохранении файлов" });
                        return;
                    }

                    message.files = createdFiles;
                }
                await client.query('COMMIT');
                res.status(200).json({ message: "Сообщение успешно отправлено", createdMessage: message });
                return;
            }
            await client.query('ROLLBACK');
            res.status(400).json({ message: "Ошибка при отправке сообщения. Информация о сообщении не должна быть пустой" });
            return;
        }
        catch (error) {
            await client.query('ROLLBACK');
            res.status(500).json({ message: "Ошибка при отправке сообщения" });
            console.log(error);
            return;
        }
        finally {
            client.release();
        }
    }
    static async deleteMessages(req: Request, res: Response) {
        try {
            
        }
        catch (error) {
            res.status(500).json({ message: "Ошибка при удалении сообщений" });
            console.log(error);
            return;
        }
    }
    static async changeMessage(req: Request, res: Response) {
        try {
            
        }
        catch (error) {
            res.status(500).json({ message: "Ошибка при изменении сообщения" });
            console.log(error);
            return;
        }
    }
    static async getUserDialogs(req: Request, res: Response) {
        try {
            
        }
        catch (error) {
            res.status(500).json({ message: "Ошибка при получении диалогов" });
            console.log(error);
            return;
        }
    }
    static async getUserDialogInfo(req: Request, res: Response) {
        try {
            /* Получение информации о диалоге пользователя
                SELECT DISTINCT
                    dialogs_members.dialog_id,
                    messages.id as message_id,
                    messages.text,
                    messages.date,
                    messages.sender_id,
                    files.name,
                    files.size,
                    files.type,
                    files.url
                FROM dialogs_members
                JOIN messages ON messages.dialog_id = dialogs_members.dialog_id
                left JOIN files ON files.message_id = messages.id 
                WHERE dialogs_members.dialog_id = 9;
            */
        }  
        catch (error) {
            res.status(500).json({ message: "Ошибка при получении информации о диалоге" });
            console.log(error);
            return;
        }
    }
    static async deleteDialog(req: Request, res: Response) {
        try {
            
        }
        catch (error) {
            res.status(500).json({ message: "Ошибка при удалении диалога" });
            console.log(error);
            return;
        }
    }
}

export default DialogsController;