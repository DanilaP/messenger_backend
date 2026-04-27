import { FileArray } from 'express-fileupload';
import fs from 'fs';
import path from 'path';

interface IFile {
    url: string,
    name: string,
    size: number,
    type: string
}

// Гарантированное создание директории (рекурсивно)
async function ensureDirectoryExists(dirPath: string): Promise<void> {
    try {
        await fs.promises.mkdir(dirPath, { recursive: true });
    } catch (err) {
        console.error(`Ошибка при создании директории ${dirPath}:`, err);
        throw err;
    }
}

async function uploadFiles(files: FileArray, baseDirPath: string) {
    if (files && Object.keys(files).length !== 0) {

        // Преобразуем baseDirPath из latin1 в utf8 для поддержки русских символов
        const normalizedBaseDir = Buffer.from(baseDirPath, 'latin1').toString('utf8');
        // Формируем безопасный путь с помощью path.join (избегаем двойных слешей)
        const uploadDir = path.join('./static', normalizedBaseDir);
        // Создаём папку, если её нет
        await ensureDirectoryExists(uploadDir);

        // Поддержка как массива файлов, так и одного файла
        const uploadedFiles = Array.isArray(files.files) ? files.files : [files.files];
        let filelist: IFile[] = [];

        await Promise.all(uploadedFiles.map(async (file: any) => {
            const fileName = Buffer.from(file.name, 'latin1').toString('utf8');
            const currentDate = Date.now();
            const uniqueFileStats = `${currentDate}_${file.size}_${fileName}`;
            const targetPath = path.join(uploadDir, uniqueFileStats);
            // Перемещаем файл
            await file.mv(targetPath);

            filelist.push({
                url: `${process.env.HOST_URL}/${targetPath}`,
                name: fileName,
                size: file.size,
                type: file.mimetype
            });
        }));

        return { filelist, status: 200 };
    }
    return { filelist: [], status: 500 };
}

async function removeFiles(filesURL: string[]) {
    let status = 200;
    if (filesURL.length !== 0) {
        for (const url of filesURL) {
            try {
                await fs.promises.unlink(url);
            } catch (err) {
                console.error(`Не удалось удалить файл ${url}:`, err);
                status = 500;
            }
        }
    }
    return { status };
}

export default { uploadFiles, removeFiles };