import { Request, Response } from 'express';
import { db } from '../../models/db';
import { IMessage } from '../../models/messages/messages';
import { IDialogs } from '../../models/dialogs/dialogs';
import { insertFiles } from '../../models/files/model-helpers';
import { insertDialogMembers } from '../../models/dialogs-members/model-helpers';
import jwt, { JwtPayload } from "jsonwebtoken";
import moment from 'moment';
import fsHelpers from '../../helpers/fs-helpers';

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
                    dialog_id: dialogId || "",
                    sender_id: userId,
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

                //Проверяем что пользователь участник диалога
                const memberCheck = await client.query(
                    'SELECT * FROM dialogs_members WHERE dialog_id = $1 AND user_id = $2 FOR UPDATE',
                    [dialogId, userId]
                );
                if (memberCheck.rowCount === 0) {
                    await client.query('ROLLBACK');
                    return res.status(403).json({ message: "Вы не являетесь участником этого диалога" });
                }

                //Добавляем в бд сообщение
                const createdMessage = await client.query<IMessage>(
                    `INSERT INTO messages (text, date, dialog_id, sender_id) 
                    VALUES ($1, $2, $3, $4) 
                    RETURNING id, text, date, dialog_id, sender_id`,
                    [text, message.date, message.dialog_id, message.sender_id]
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