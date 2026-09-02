import { NextFunction, Request, Response } from "express";
import { checkMember } from "../models/dialogs/model-helpers";
import { checkChatMember } from "../models/chats/model-helpers";
import userHelpers from "../helpers/user-helpers";

const checkUserAccessToDialog = async (userId: number, dialogId: number): Promise<boolean> => {
	const result = await checkMember(userId, dialogId);
	return result;
};

export const checkDialogFileAccess = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
	try {
		const userId = userHelpers.getUserIdFromToken(req);
		const dialogId = parseInt(req.params.dialogId, 10);

		if (isNaN(dialogId)) {
			res.status(400).send("Invalid dialog ID");
			return;
		}

		const hasAccess = await checkUserAccessToDialog(userId, dialogId);

		if (!hasAccess) {
			res.status(403).send("Forbidden");
			return;
		}

		next();
	} catch (error) {
		res.status(500).send("Internal Server Error");
		console.error(error);
	}
};

export const checkChatFileAccess = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
	try {
		const userId = userHelpers.getUserIdFromToken(req);
		const chatId = parseInt(req.params.chatId, 10);

		if (isNaN(chatId)) {
			res.status(400).send("Invalid dialog ID");
			return;
		}

		const hasAccess = await checkChatMember(chatId, userId);
		
		if (!hasAccess) {
			res.status(403).send("Forbidden");
			return;
		}

		next();
	} catch (error) {
		res.status(500).send("Internal Server Error");
		console.error(error);
	}
};