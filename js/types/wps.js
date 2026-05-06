export function isWpsApp(value) {
    return (typeof value === 'object' &&
        value !== null &&
        'ActiveWorkbook' in value);
}
export function isWpsWorksheet(value) {
    return (typeof value === 'object' &&
        value !== null &&
        'Name' in value &&
        'Range' in value);
}
export function isWpsRange(value) {
    return (typeof value === 'object' &&
        value !== null &&
        ('Row' in value ||
            'Value' in value ||
            'Value2' in value));
}
