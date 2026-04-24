export function validateEmail(str: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(str);
}

export function validatePassword(str: string): boolean {
    return (str.length >= 6);
}