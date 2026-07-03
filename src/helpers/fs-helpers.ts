import { FileArray } from "express-fileupload";
import fs from "fs";
import path from "path";

interface IFile {
    url: string,
    name: string,
    size: number,
    type: string
}

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
		const normalizedBaseDir = Buffer.from(baseDirPath, "latin1").toString("utf8");
		const uploadDir = path.join("./static", normalizedBaseDir);
		await ensureDirectoryExists(uploadDir);

		const uploadedFiles = Array.isArray(files.files) ? files.files : [files.files];
		const filelist: IFile[] = [];

		await Promise.all(uploadedFiles.map(async (file: any) => {
			const fileName = Buffer.from(file.name, "latin1").toString("utf8");
			const currentDate = Date.now();
			const uniqueFileStats = `${currentDate}_${file.size}_${fileName}`;
			const targetPath = path.join(uploadDir, uniqueFileStats);
			await file.mv(targetPath);

			//Получаем путь относительно папки static (без './static')
			const relativePath = path.relative("./static", targetPath).split(path.sep).join("/");
			const fileUrl = `/${relativePath}`;

			filelist.push({
				url: fileUrl,
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
	for (const url of filesURL) {
		try {
			const finalUrl = `./static/${url}`;
			await fs.promises.unlink(finalUrl);
		} catch (err) {
			console.error(`Не удалось удалить файл ${url}:`, err);
			status = 500;
		}
	}
	return { status };
}

const ALLOWED_IMAGE_MIMES = [
	"image/jpeg",
	"image/jpg",
	"image/png",
	"image/gif",
	"image/webp",
	"image/bmp",
	"image/svg+xml"
];

//Функция проверки, что все переданные файлы - изображения опр. типа
export const areAllImages = (files: FileArray) => {
	if (!files) return true;

	const fileArray = Array.isArray(files.files) ? files.files : [files.files];

	if (fileArray.length === 0) return true;

	// Проверяем каждый файл
	for (const file of fileArray) {
		// У файла отсутствует mimetype или он не разрешён
		if (!file.mimetype || !ALLOWED_IMAGE_MIMES.includes(file.mimetype)) {
			return false;
		}
	}

	return true;
};

export default { uploadFiles, removeFiles, areAllImages };