/**
 * Logger utility for the extension
 */
export class Logger {
    constructor(name) {
        this.prefix = `%c[${name}]`;
        this.style = 'background: #007bff; color: white; padding: 2px 4px; border-radius: 3px; font-weight: bold;';
    }

    log(...args) {
        console.log(this.prefix, this.style, ...args);
    }

    warn(...args) {
        console.warn(this.prefix, this.style, ...args);
    }

    error(...args) {
        console.error(this.prefix, this.style, ...args);
    }

    debug(...args) {
        if (window.DEBUG) {
            console.debug(this.prefix, this.style, ...args);
        }
    }
}
