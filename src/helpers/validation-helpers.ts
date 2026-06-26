export function validateEmail(str: string): boolean {
	const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
	return emailRegex.test(str);
}

export function validatePassword(str: string): boolean {
	return (str.length >= 6);
}

export function validateOnlyLetterStringValue(str: string): boolean {
	const regex = /^\p{L}+$/u;
  	return regex.test(str);
}

export function validateOnlyLettersAndNumbersStringValue(str: string): boolean {
	const regex = /^[\p{L}\p{N}]+$/u;
  	return regex.test(str);
}