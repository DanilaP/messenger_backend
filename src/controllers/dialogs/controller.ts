import { Request, Response } from 'express';
import { db } from '../../models/db';
import { IDialogsMessage } from '../../models/dialogs-messages/dialogs-messages';
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
                const createdMessage = await client.query<IDialogsMessage>(
                    `INSERT INTO dialogs_messages (text, date, dialog_id, sender_id) 
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
        const client = await db.getClient();

        try {   
            await client.query('BEGIN');

            const { dialogId, messagesIds } = req.body;
            const payload = jwt.verify(req.cookies?.token, process.env.JWT_SECRET!) as JwtPayload;
            const userId = Number(payload.id);

            if (userId && dialogId && messagesIds.length > 0) {
                //Удаляем ссылки на файлы статики из бд
                const deletedFilesResult = await client.query(
                    `
                        DELETE FROM files
                        WHERE message_id = ANY($1::int[])
                        RETURNING url
                    `,
                    [messagesIds]
                );
                
                const deletedFilesUrls = deletedFilesResult.rows.map(row => {
                    return row.url.replace(process.env.HOST_URL, `./static`);
                });
                const deleteFilesStatus = await fsHelpers.removeFiles(deletedFilesUrls);
                //Удаляем статику 
                
                if (deleteFilesStatus.status === 500) {
                    await client.query('ROLLBACK');
                    res.status(500).json({ 
                        message: "Ошибка при удалении сообщений. Ошибка при удалении медиа файлов" 
                    });
                    return;
                }

                //Удаляем сообщения из бд
                const deletedMessagesResult = await client.query(
                    `
                        DELETE FROM dialogs_messages
                        WHERE dialog_id = $1 AND id = ANY($2::int[]) and sender_id = $3
                    `,
                    [dialogId, messagesIds, userId]
                );
                const deletedCount = deletedMessagesResult.rowCount; 

                if (deletedCount === 0) {
                    await client.query('ROLLBACK');
                    res.status(500).json({ message: "Ошибка при удалении сообщений. Сообщения или диалог не найдены" });
                    return;
                }

                await client.query('COMMIT');
                res.status(200).json({ message: "Сообщения успешно удалены" });
                return;
            }
            await client.query('ROLLBACK');
            res.status(500).json({ 
                message: "Ошибка при удалении сообщений. Информация о диалоге и сообщениях не должна быть пустой" 
            });
            return;
        }
        catch (error) {
            await client.query('ROLLBACK');
            res.status(500).json({ message: "Ошибка при удалении сообщений" });
            console.log(error);
            return;
        }
        finally {
            client.release();
        }
    }
    static async changeMessage(req: Request, res: Response) {
        try {
            const { dialogId, messageId, text } = req.body;
            const payload = jwt.verify(req.cookies?.token, process.env.JWT_SECRET!) as JwtPayload;
            const userId = Number(payload.id);

            if (dialogId && messageId && text) {
                const updatedMessage = await db.query(
                    `
                        UPDATE dialogs_messages
                        SET text = $4
                        WHERE dialogs_messages.dialog_id = $2 and dialogs_messages.sender_id = $1 and dialogs_messages.id = $3;
                    `,
                    [userId, dialogId, messageId, text]
                );
                
                if (updatedMessage.rowCount === 0) {
                    res.status(500).json({ 
                        message: "Ошибка при изменении сообщения. Ошибка записи данных" 
                    });
                    return;
                }
                res.status(200).json({ message: "Сообщение успешно изменено" });
                return;
            }
            res.status(400).json({ message: "Ошибка при изменении сообщения. Данные о сообщении не должны быть пустыми" });
            return;
        }
        catch (error) {
            res.status(500).json({ message: "Ошибка при изменении сообщения" });
            console.log(error);
            return;
        }
    }
    static async getUserDialogsInfo(req: Request, res: Response) {
        try {
            const dialogId = Number(req.query.id);
            const payload = jwt.verify(req.cookies?.token, process.env.JWT_SECRET!) as JwtPayload;
            const userId = Number(payload.id);

            //Получение информации о конкретном диалоге
            if (dialogId) {
                const dialog = await db.query(
                    `SELECT 
                        dialogs_messages.id as message_id,
                        dialogs_messages.text,
                        dialogs_messages.date,
                        dialogs_messages.sender_id,
                        COALESCE(
                            json_agg(
                                json_build_object('name', files.name, 'size', files.size, 'type', files.type, 'url', files.url)
                                ORDER BY files.id
                            ) FILTER (WHERE files.id IS NOT NULL),
                            '[]'::json
                        ) as files
                    FROM dialogs_messages
                    LEFT JOIN files ON files.message_id = dialogs_messages.id
                    WHERE dialogs_messages.dialog_id = $1
                    GROUP BY dialogs_messages.id, dialogs_messages.dialog_id, dialogs_messages.text, dialogs_messages.date, dialogs_messages.sender_id
                    ORDER BY dialogs_messages.date
                    `,
                    [dialogId]
                );

                const membersInfo = await db.query(
                    `
                        SELECT user_id from dialogs_members where dialog_id = $1
                    `,
                    [dialogId]
                );

                let isMember = false;
                membersInfo.rows.map(row => {
                    if (row.user_id === userId) {
                        isMember = true;
                    }
                });

                if (isMember) {
                    res.status(200).json({ message: "Успешное получение информации о диалоге", dialog: dialog.rows });
                    return;
                }
                
                res.status(403).json({ message: "Вы не являетесь участником данного диалога!" });
                return;
            }
            //Получение всех диалогов
            else {  
                const dialogs = await db.query(
                    `SELECT json_agg(
                        json_build_object(
                            'dialog_id', sub.dialog_id,
                            'last_message', json_build_object(
                                'text', sub.text,
                                'date', sub.date
                            ),
                            'opponent', json_build_object(
                                'id', sub.opponent_id,
                                'name', sub.name,
                                'surname', sub.surname,
                                'avatar', sub.avatar
                            )
                        )
                    ) AS result
                    FROM (
                        SELECT DISTINCT ON (dialogs_messages.dialog_id) 
                            dialogs_messages.text, 
                            dialogs_messages.date, 
                            dialogs_messages.dialog_id, 
                            dialogs_messages.sender_id,
                            dialogs_members.user_id AS opponent_id,
                            users.name,
                            users.surname,
                            users.avatar
                        FROM dialogs_messages
                        JOIN dialogs_members 
                            ON dialogs_members.dialog_id = dialogs_messages.dialog_id 
                            AND dialogs_members.user_id != $1
                        JOIN users 
                            ON users.id = dialogs_members.user_id
                        WHERE dialogs_messages.dialog_id IN (
                            SELECT dialog_id 
                            FROM dialogs_members 
                            WHERE user_id = $1
                        )
                        ORDER BY dialogs_messages.dialog_id, dialogs_messages.date DESC NULLS LAST, dialogs_messages.id DESC
                    ) sub
                    `,
                    [userId]
                );
                res.status(200).json({ message: "Список диалогов успешно получен", dialogs: dialogs.rows[0].result });
                return;
            }
        }  
        catch (error) {
            res.status(500).json({ message: "Ошибка при получении информации о диалогах" });
            console.log(error);
            return;
        }
    }
    static async deleteDialog(req: Request, res: Response) {
        const client = await db.getClient();

        try {
            await client.query('BEGIN');

            const dialogId = Number(req.query.id);
            const payload = jwt.verify(req.cookies?.token, process.env.JWT_SECRET!) as JwtPayload;
            const userId = Number(payload.id);

            if (dialogId && userId) {
                //Проверяем, является ли пользователь участником удаляемого диалога
                const memberCheck = await client.query(
                    'SELECT * FROM dialogs_members WHERE dialog_id = $1 AND user_id = $2 FOR UPDATE',
                    [dialogId, userId]
                );
                if (memberCheck.rowCount === 0) {
                    await client.query('ROLLBACK');
                    res.status(403).json({ message: "Вы не являетесь участником этого диалога" });
                    return
                }   

                //Удаляем ссылки на файлы статики из бд
                const deletedFilesResult = await client.query(
                    `
                        DELETE FROM files
                        WHERE message_id IN (SELECT id FROM messages WHERE dialog_id = $1)
                        RETURNING url
                    `,
                    [dialogId]
                );
                
                //Удаляем статику 
                const deletedFilesUrls = deletedFilesResult.rows.map(row => {
                    return row.url.replace(process.env.HOST_URL, `./static`);
                });
                const deleteFilesStatus = await fsHelpers.removeFiles(deletedFilesUrls);

                if (deleteFilesStatus.status === 500) {
                    await client.query('ROLLBACK');
                    res.status(500).json({ 
                        message: "Ошибка при удалении сообщений. Ошибка при удалении медиа файлов" 
                    });
                    return;
                }

                //Удаляем сообщения из бд
                await client.query(
                    `
                        DELETE FROM dialogs_messages
                        WHERE dialog_id = $1
                    `,
                    [dialogId]
                );

                //Удаляем привязку участников к диалогу
                await client.query(
                    `
                        DELETE FROM dialogs_members
                        WHERE dialog_id = $1
                    `,
                    [dialogId]
                );

                //Удаляем сам диалог
                const deletedDialogsInfo = await client.query(
                    `
                        DELETE FROM dialogs
                        WHERE id = $1
                    `,
                    [dialogId]
                );

                if (deletedDialogsInfo.rowCount === 0) {
                    await client.query('ROLLBACK');
                    res.status(500).json({
                        message: "Ошибка при удалении диалога. Диалог не найден" 
                    });
                    return;
                }

                await client.query('COMMIT');
                res.status(200).json({ message: "Диалог успешно удален" });
                return;
            }
            await client.query('ROLLBACK');
            res.status(400).json({ message: "Ошибка при удалении диалога, диалог не найден" });
            return;
        }
        catch (error) {
            await client.query('ROLLBACK');

            res.status(500).json({ message: "Ошибка при удалении диалога" });
            console.log(error);
            return;
        }
        finally {
            client.release();
        }
    }
}

export default DialogsController;