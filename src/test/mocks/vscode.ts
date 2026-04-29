/**
 * Mock vscode module for testing
 * This file provides a minimal implementation of vscode types for unit tests
 */

class MockEventEmitter<T> {
    private listeners: Array<(data: T) => void> = [];

    event(callback: (data: T) => void): void {
        this.listeners.push(callback);
    }

    fire(data: T): void {
        this.listeners.forEach(listener => listener(data));
    }
}

class MockSecretStorage {
    private _storage = new Map<string, string>();
    private _onDidChange = new MockEventEmitter<{ key: string }>();

    async get(key: string): Promise<string | undefined> {
        return this._storage.get(key);
    }

    async store(key: string, value: string): Promise<void> {
        this._storage.set(key, value);
    }

    async delete(key: string): Promise<void> {
        this._storage.delete(key);
    }

    get onDidChange() {
        return this._onDidChange.event.bind(this._onDidChange);
    }

    async keys(): Promise<string[]> {
        return Array.from(this._storage.keys());
    }
}

class MockWorkspaceConfiguration {
    private _config = new Map<string, any>();

    get<T>(key: string, defaultValue?: T): T | undefined {
        return this._config.has(key) ? this._config.get(key) : defaultValue;
    }

    async update(key: string, value: any): Promise<void> {
        this._config.set(key, value);
    }

    has(key: string): boolean {
        return this._config.has(key);
    }

    inspect(key: string): any {
        return undefined;
    }
}

export const ConfigurationTarget = {
    Global: 1,
    Workspace: 2,
    WorkspaceFolder: 3
};

export const SecretStorage = MockSecretStorage as any;
export const WorkspaceConfiguration = MockWorkspaceConfiguration as any;

// Export a mock vscode module
export default {
    SecretStorage: MockSecretStorage,
    WorkspaceConfiguration: MockWorkspaceConfiguration,
    ConfigurationTarget
};
