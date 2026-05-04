import { Request, Response } from 'express';
import { db } from '../../../db';
import { IDialogsMessage } from '../../models/dialogs-messages/dialogs-messages';
import { IDialogs } from '../../models/dialogs/dialogs';
import { insertFiles } from '../../models/dialogs-files/model-helpers';
import { insertDialogMembers } from '../../models/dialogs-members/model-helpers';
import { IDialogsMembers } from '../../models/dialogs-members/dialogs-members';
import { broadcastMessage } from '../../websocket/websocket';
import { IFile } from '../../models/dialogs-files/dialogs-files';
import { checkMember } from '../../models/dialogs/model-helpers';
import moment from 'moment';
import fsHelpers from '../../helpers/fs-helpers';
import userHelpers from '../../helpers/user-helpers';

require('dotenv').config();

interface IMessage {
    message_id: number;
    text: string;
    date: string;
    dialog_id: number;
    sender_id: number;
    isread: boolean;
    files: Omit<IFile, 'id' | 'message_id'>[];
    replayMessage: number | null;
}

class DialogsController {
    static async sendMessage(req: Request, res: Response) {
        const client = await db.getClient();

        try {
            await client.query('BEGIN');

            const { text, opponentId } = req.body;
            const replayMessageId = req.body.replayMessageId ? Number(req.body.replayMessageId) : null;
            const userId = userHelpers.getUserIdFromToken(req);

            if ((text || req.files) && opponentId && opponentId !== userId) {
                const message: IMessage = {
                    message_id: 0,
                    text: text || "",
                    date: moment(Date.now()).format('DD:MM:YYYY HH:mm:ss'),
                    dialog_id: 0,
                    sender_id: Number(userId),
                    isread: false,
                    files: [],
                    replayMessage: null
                };

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

                // Диалог уже есть - используем его id
                if (existingDialog.rows.length > 0) {
                    message.dialog_id = existingDialog.rows[0].dialog_id;
                } 
                // Если диалога еще нет
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
                
                //Создаем файлы в статике
                if (req.files) {
                    message.files = 
                        req.files ? (await fsHelpers.uploadFiles(req.files, `/dialogs-files/${message.dialog_id}`)).filelist : [];
                }

                //Добавляем в бд сообщение
                const createdMessage = await client.query<IDialogsMessage>(
                    `INSERT INTO dialogs_messages (text, date, dialog_id, sender_id, replay_message_id) 
                    VALUES ($1, $2, $3, $4, $5) 
                    RETURNING id, text, date, dialog_id, sender_id, replay_message_id`,
                    [text, message.date, Number(message.dialog_id), Number(message.sender_id), replayMessageId]
                );

                //Создаем файлы в бд
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

                message.message_id = createdMessage.rows[0].id;

                if (createdMessage.rows.length === 0) {
                    await client.query('ROLLBACK');
                    res.status(500).json({ message: "Ошибка при отправке сообщения. Ошибка сохранения сообщения" });
                    return;
                }

                await client.query('COMMIT');

                const senderInfo = await db.query(
                    'SELECT id, name, surname, avatar FROM users WHERE id = $1',
                    [userId]
                );

                broadcastMessage([opponentId], {
                    type: "new_message_dialog",
                    dialogId: message.dialog_id,
                    message: message,
                    senderInfo: senderInfo.rows[0]
                });

                if (replayMessageId !== null) {
                    const replayedMessageInfo = await client.query(
                        `SELECT id, text, sender_id as "senderId" 
                        FROM dialogs_messages 
                        WHERE dialog_id = $1 AND id = $2 FOR UPDATE`,
                        [Number(message.dialog_id), Number(replayMessageId)]
                    );
                    message.replayMessage = replayedMessageInfo.rows[0];
                }

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
            const userId = userHelpers.getUserIdFromToken(req);

            if (userId && dialogId && messagesIds.length > 0) {
                //Удаляем ссылки на файлы статики из бд
                const deletedFilesResult = await client.query(
                    `
                        DELETE FROM dialogs_files
                        WHERE message_id = ANY($1::int[])
                        RETURNING url
                    `,
                    [messagesIds]
                );
                
                //Удаляем статику 
                const deletedFilesUrls = deletedFilesResult.rows.map(row => {
                    return row.url;
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

                const recepientId = await db.query<{ id: number }>(
                    `
                        SELECT id FROM users WHERE id IN 
	                        (select user_id as id from dialogs_members where dialog_id = $2 and user_id <> $1)
                    `,
                    [userId, dialogId]
                );
                broadcastMessage([recepientId.rows[0].id], {
                    type: "delete_message_dialog",
                    dialogId: dialogId,
                    deletedMessagesIds: messagesIds
                });

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
        const client = await db.getClient();

        try {
            await client.query('BEGIN');

            const { dialogId, messageId, text } = req.body;
            const userId = userHelpers.getUserIdFromToken(req);

            const modifiedMessageInfo: { id: number, text: string, files: Partial<IFile>[] } = {
                id: messageId,
                text: text,
                files: []
            };

            if (dialogId && messageId && text) {
                const updatedMessage = await client.query(
                    `
                        UPDATE dialogs_messages
                        SET text = $4
                        WHERE dialogs_messages.dialog_id = $2 and dialogs_messages.sender_id = $1 and dialogs_messages.id = $3;
                    `,
                    [userId, dialogId, messageId, text]
                );
                
                if (updatedMessage.rowCount === 0) {
                    await client.query('ROLLBACK');
                    res.status(500).json({ 
                        message: "Ошибка при изменении сообщения. Ошибка записи данных" 
                    });
                    return;
                }
                
                //Если необходимо удалить предыдущие файлы сообщения
                if (req.body.deleteMessageFiles) {
                    //Удаляем ссылки на файлы статики из бд
                    const deletedFilesResult = await client.query(
                        `
                            DELETE FROM dialogs_files
                            WHERE message_id = $1
                            RETURNING url
                        `,
                        [messageId]
                    );
                    
                    //Удаляем статику 
                    const deletedFilesUrls = deletedFilesResult.rows.map(row => {
                        return row.url;
                    });
                    const deleteFilesStatus = await fsHelpers.removeFiles(deletedFilesUrls);
                    
                    modifiedMessageInfo.files = [];

                    if (deleteFilesStatus.status === 500) {
                        await client.query('ROLLBACK');
                        res.status(500).json({ 
                            message: "Ошибка при удалении сообщений. Ошибка при удалении предыдущих медиа файлов" 
                        });
                        return;
                    }
                }
                //Если необходимо заменить предыдущие файлы сообщения
                else if (req.files) {
                    //Удаляем ссылки на файлы статики из бд
                    const deletedFilesResult = await client.query(
                        `
                            DELETE FROM dialogs_files
                            WHERE message_id = $1
                            RETURNING url
                        `,
                        [messageId]
                    );
                    
                    //Удаляем статику 
                    const deletedFilesUrls = deletedFilesResult.rows.map(row => {
                        return row.url;
                    });
                    const deleteFilesStatus = await fsHelpers.removeFiles(deletedFilesUrls);

                    if (deleteFilesStatus.status === 500) {
                        await client.query('ROLLBACK');
                        res.status(500).json({ 
                            message: "Ошибка при удалении сообщений. Ошибка при удалении предыдущих медиа файлов" 
                        });
                        return;
                    }

                    //Сохраняем новые файлы в статику
                    const uploadedFiles = (await fsHelpers.uploadFiles(req.files, `/dialogs-files/${dialogId}`));

                    modifiedMessageInfo.files = uploadedFiles.filelist;

                    if (uploadedFiles.status === 500) {
                        await client.query('ROLLBACK');
                        res.status(500).json({ message: "Ошибка при редактировании сообщения. Ошибка при сохранении файлов в статике" });
                        return;
                    }

                    const modifiedFiles = uploadedFiles.filelist.map(file => { 
                        return {
                            ...file, 
                            message_id: messageId
                        }
                    });
                    const createdFiles = await insertFiles(client, modifiedFiles);
                    
                    if (createdFiles.length === 0) {
                        await client.query('ROLLBACK');
                        res.status(500).json({ message: "Ошибка при редактировании сообщения. Ошибка при сохранении файлов в базу" });
                        return;
                    }
                }

                await client.query('COMMIT');

                const recepientId = await db.query<{ id: number }>(
                    `
                        SELECT id FROM users WHERE id IN 
	                        (select user_id as id from dialogs_members where dialog_id = $2 and user_id <> $1)
                    `,
                    [userId, dialogId]
                );
                broadcastMessage([recepientId.rows[0].id], {
                    type: "change_message_dialog",
                    dialogId: dialogId,
                    message: modifiedMessageInfo
                });

                res.status(200).json({ message: "Сообщение успешно изменено", modifiedMessageInfo });
                return;
            }
            res.status(400).json({ message: "Ошибка при изменении сообщения. Данные о сообщении не должны быть пустыми" });
            return;
        }
        catch (error) {
            await client.query('ROLLBACK');

            res.status(500).json({ message: "Ошибка при изменении сообщения" });
            console.log(error);
            return;
        }
        finally {
            client.release();
        }
    }
    static async getUserDialogsInfo(req: Request, res: Response) {
        try {
            const dialogId = Number(req.query.id);
            const mode = req.query.mode;
            const messageId = req.query.messageId ? Number(req.query.messageId) : null;
            const userId = userHelpers.getUserIdFromToken(req);
    
            //Получение информации о конкретном диалоге
            if (dialogId) {
                const opponentInfo = await db.query(
                    `
                        SELECT 
                            user_id as id,
                            users.name,
                            users.surname,
                            users.avatar
                        FROM dialogs_members
                        JOIN users on users.id = user_id 
                        WHERE dialog_id = $1 and user_id <> $2
                    `,
                    [dialogId, userId]
                );
                
                const baseCTE = `
                    WITH full_data AS (
                        SELECT 
                            m.id AS message_id,
                            m.is_read AS isread,
                            m.text,
                            m.date,
                            m.sender_id,
                            TO_TIMESTAMP(m.date, 'DD:MM:YYYY HH24:MI:SS') AS ts,
                            COALESCE(
                                json_agg(
                                    json_build_object('name', f.name, 'size', f.size, 'type', f.type, 'url', f.url)
                                    ORDER BY f.id
                                ) FILTER (WHERE f.id IS NOT NULL),
                                '[]'::json
                            ) AS files,
                            CASE WHEN m.replay_message_id IS NOT NULL THEN
                                json_build_object(
                                    'id', rm.id,
                                    'text', rm.text,
                                    'senderId', rm.sender_id
                                )
                            ELSE NULL END AS "replayMessage",
                            ROW_NUMBER() OVER (ORDER BY TO_TIMESTAMP(m.date, 'DD:MM:YYYY HH24:MI:SS'), m.id) AS rn
                        FROM dialogs_messages m
                        LEFT JOIN dialogs_files f ON f.message_id = m.id
                        LEFT JOIN dialogs_messages rm ON rm.id = m.replay_message_id
                        WHERE m.dialog_id = $1
                        GROUP BY 
                            m.id, m.is_read, m.text, m.date, m.sender_id, m.replay_message_id,
                            rm.id, rm.text, rm.sender_id
                    )
                `;

                let messagesQuery: string;
                let queryParams: any[];

                if (messageId) {
                    // Формируем условие для ROW_NUMBER в зависимости от направления
                    const rangeCondition = mode === 'next'
                        ? 'rn BETWEEN (SELECT rn FROM target_rn) + 1 AND (SELECT rn FROM target_rn) + 10'
                        : 'rn BETWEEN (SELECT rn FROM target_rn) - 10 AND (SELECT rn FROM target_rn) - 1';
                    
                    messagesQuery = baseCTE + `
                        , target_rn AS (
                            SELECT rn FROM full_data WHERE message_id = $2
                        )
                        SELECT message_id, isread, text, date, sender_id, files, "replayMessage"
                        FROM full_data
                        WHERE ${rangeCondition}
                        ORDER BY ts ASC, message_id ASC
                    `;
                    queryParams = [dialogId, messageId];
                } else {
                    // Последние 10 сообщений
                    messagesQuery = baseCTE + `
                        SELECT message_id, isread, text, date, sender_id, files, "replayMessage"
                        FROM (
                            SELECT * FROM full_data
                            ORDER BY ts DESC
                            LIMIT 10
                        ) last_page
                        ORDER BY ts ASC, message_id ASC
                    `;
                    queryParams = [dialogId];
                }

                const dialog = await db.query(messagesQuery, queryParams);

                const isMember = await checkMember(userId, dialogId);

                if (isMember) {
                    //Заменяем url на корректный для всех файлов
                    const modifiedMessages = dialog.rows.map(message => {
                        return {
                            ...message,
                            files: message.files.map((file: IFile) => {
                                return {
                                    ...file,
                                    url: `${ process.env.HOST_URL }${file.url}`
                                }
                            })
                        }
                    })
                    res.status(200).json({ 
                        message: "Успешное получение информации о диалоге", 
                        dialog: {
                            id: dialogId,
                            messages: modifiedMessages,
                            opponent: {
                                ...opponentInfo.rows[0],
                                avatar: `${ process.env.HOST_URL }${opponentInfo.rows[0].avatar}`
                            }
                        }
                    });
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
                                'id', sub.id,
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
                            dialogs_messages.id,
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
                        ORDER BY dialogs_messages.dialog_id, TO_TIMESTAMP(dialogs_messages.date, 'DD:MM:YYYY HH24:MI:SS') DESC NULLS LAST, dialogs_messages.id DESC
                    ) sub
                    `,
                    [userId]
                );
                const modifiedDialogs = dialogs.rows[0].result.map((dialog: any) => {
                    return {
                        ...dialog,
                        opponent: {
                            ...dialog.opponent,
                            avatar: `${ process.env.HOST_URL }${dialog.opponent.avatar}`
                        }
                    }
                })
                res.status(200).json({ message: "Список диалогов успешно получен", dialogs: modifiedDialogs });
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
            const userId = userHelpers.getUserIdFromToken(req);

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
                        DELETE FROM dialogs_files
                        WHERE message_id IN (SELECT id FROM dialogs_messages WHERE dialog_id = $1)
                        RETURNING url
                    `,
                    [dialogId]
                );

                //Удаляем статику 
                const deletedFilesUrls = deletedFilesResult.rows.map(row => {
                    return row.url;
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
    static async getDialogFiles(req: Request, res: Response) {
        try {
            const userId = userHelpers.getUserIdFromToken(req);
            const dialogId = Number(req.query.id);

            if (userId && dialogId) {
                const memberCheck = await db.query<IDialogsMembers>(
                    'SELECT * FROM dialogs_members WHERE dialog_id = $1 AND user_id = $2 FOR UPDATE',
                    [dialogId, userId]
                );
                if (memberCheck.rowCount === 0) {
                    await db.query('ROLLBACK');
                    res.status(403).json({ message: "Вы не являетесь участником этого диалога" });
                    return
                }
                const dialogFiles = await db.query(
                    `   
                        select 
                            dialogs_messages.id as message_id, 
                            dialogs_messages.date, 
                            dialogs_messages.sender_id,
                            dialogs_files.url,
                            dialogs_files.type
                        from dialogs_messages
                        join dialogs_files on dialogs_messages.id = dialogs_files.message_id 
                        where dialog_id = $1
                    `,
                    [dialogId]
                );
                res.status(200).json({ message: "Успешное получение файлов диалога", files: dialogFiles.rows });
                return;
            }
            res.status(400).json({ message: "Ошибка при получении файлов диалога. Диалог не найден" });
            return;
        }
        catch (error) {
            res.status(500).json({ message: "Ошибка при получении файлов диалога" });
            console.log(error);
            return;
        }
    }
    static async readMessagesInCertainDialog(req: Request, res: Response) {
        try {
            const userId = userHelpers.getUserIdFromToken(req);
            const { dialogId, opponentId } = req.body;

            if (dialogId && opponentId) {
                const isMember = await checkMember(userId, dialogId);

                if (isMember) {
                    const updatedMessages = await db.query(
                        ` 
                            UPDATE dialogs_messages 
                            SET is_read = true 
                            WHERE dialog_id = $1 and sender_id = $2 and is_read <> true
                            RETURNING id as message_id, is_read as isread
                        `,
                        [dialogId, opponentId]
                    );

                    broadcastMessage([opponentId], {
                        type: "read_message_dialog",
                        dialogId: dialogId,
                        readMessages: updatedMessages.rows
                    });

                    res.status(200).json({ message: "Сообщения успешно прочитаны", readMessages: updatedMessages.rows });
                    return;
                }
                else {
                    res.status(403).json({ message: "Ошибка при прочтении сообщений. Вы не являетесь участником данного диалога" });
                    return;
                }
            }
            res.status(400).json({ message: "Ошибка при прочтении сообщений. Диалог не найден" });
            return;
        }
        catch (error) {
            res.status(500).json({ message: "Ошибка при прочтении сообщений" });
            console.log(error);
            return;
        }
    }
    static async scrollToMessage(req: Request, res: Response) {
        try {
            const userId = userHelpers.getUserIdFromToken(req);
            const { dialogId, messageId } = req.body;

            if (dialogId && messageId) {
                const isMember = checkMember(userId, dialogId);
                if (!isMember) {
                    res.status(403).json({ 
                        message: "Ошибка при скролле к сообщению. Вы не являетесь участником данного диалога" 
                    });
                    return;
                }
                else {
                    const query = `
                        WITH full_data AS (
                            SELECT 
                                m.id AS message_id,
                                m.is_read AS isread,
                                m.text,
                                m.date,
                                m.sender_id,
                                TO_TIMESTAMP(m.date, 'DD:MM:YYYY HH24:MI:SS') AS ts,
                                COALESCE(
                                    json_agg(
                                        json_build_object('name', f.name, 'size', f.size, 'type', f.type, 'url', f.url)
                                        ORDER BY f.id
                                    ) FILTER (WHERE f.id IS NOT NULL),
                                    '[]'::json
                                ) AS files,
                                CASE WHEN m.replay_message_id IS NOT NULL THEN
                                    json_build_object(
                                        'id', rm.id,
                                        'text', rm.text,
                                        'senderId', rm.sender_id
                                    )
                                ELSE NULL END AS "replayMessage",
                                ROW_NUMBER() OVER (ORDER BY TO_TIMESTAMP(m.date, 'DD:MM:YYYY HH24:MI:SS'), m.id) AS rn
                            FROM dialogs_messages m
                            LEFT JOIN dialogs_files f ON f.message_id = m.id
                            LEFT JOIN dialogs_messages rm ON rm.id = m.replay_message_id
                            WHERE m.dialog_id = $1
                            GROUP BY 
                                m.id, m.is_read, m.text, m.date, m.sender_id, m.replay_message_id,
                                rm.id, rm.text, rm.sender_id
                        ),
                        target_rn AS (
                            SELECT rn FROM full_data WHERE message_id = $2
                        )
                        SELECT message_id, isread, text, date, sender_id, files, "replayMessage"
                        FROM full_data
                        WHERE rn BETWEEN (SELECT rn FROM target_rn) - 11 AND (SELECT rn FROM target_rn) + 11
                        ORDER BY ts ASC, message_id ASC
                    `;

                    const result = await db.query(query, [dialogId, messageId]);

                    res.status(200).json({ message: "Сообщения успешно получены", messages: result.rows });
                    return;
                }
            }
            else {
                res.status(400).json({ message: "Ошибка при скролле к сообщению. Диалог или сообщение не найдены" });
                return;
            }
        }
        catch (error) {
            res.status(500).json({ message: "Ошибка при скролле к сообщению" });
            console.log(error);
            return;
        }
    }
}

export default DialogsController;