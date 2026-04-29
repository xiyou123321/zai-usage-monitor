import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ApiConfig } from '../types/api';

interface ClaudeSettings {
    env?: {
        ANTHROPIC_AUTH_TOKEN?: string;
        ANTHROPIC_BASE_URL?: string;
        [key: string]: string | undefined;
    };
}

export type CredentialSource = 'claude' | 'env' | 'manual' | null;

export interface CredentialsWithSource {
    creds: ApiConfig;
    source: CredentialSource;
}

export class AuthService {
    constructor(
        private secretStorage: vscode.SecretStorage,
        private config: vscode.WorkspaceConfiguration,
    ) {}

    /**
     * Get credentials with priority:
     * 1. Claude Code settings.json (~/.claude/settings.json)
     * 2. VSCode process environment variables
     * 3. Stored secret/config values (manual configuration)
     */
    async getCredentials(): Promise<ApiConfig | null> {
        const result = await this.getCredentialsWithSource();
        return result?.creds ?? null;
    }

    /**
     * Get credentials with source information
     */
    async getCredentialsWithSource(): Promise<CredentialsWithSource | null> {
        // 1. Try Claude Code settings.json first
        const claudeCredentials = await this.getCredentialsFromClaudeSettings();
        if (claudeCredentials) {
            return { creds: claudeCredentials, source: 'claude' };
        }

        // 2. Try VSCode process environment variables
        const envToken = process.env.ANTHROPIC_AUTH_TOKEN;
        const envBaseUrl = process.env.ANTHROPIC_BASE_URL;

        if (envToken && envBaseUrl) {
            return { creds: { authToken: envToken, baseUrl: envBaseUrl }, source: 'env' };
        }

        // 3. Try stored credentials (manual configuration)
        const storedToken = await this.secretStorage.get('authToken');
        const storedBaseUrl = this.config.get<string>('baseUrl');

        if (storedToken && storedBaseUrl) {
            return { creds: { authToken: storedToken, baseUrl: storedBaseUrl }, source: 'manual' };
        }

        return null;
    }

    /**
     * Read credentials from Claude Code settings.json
     */
    private async getCredentialsFromClaudeSettings(): Promise<ApiConfig | null> {
        try {
            const homeDir = os.homedir();
            const settingsPath = path.join(homeDir, '.claude', 'settings.json');

            // Check if file exists
            if (!fs.existsSync(settingsPath)) {
                return null;
            }

            // Read and parse the file
            const content = fs.readFileSync(settingsPath, 'utf-8');
            const settings: ClaudeSettings = JSON.parse(content);

            // Extract credentials from env section
            const authToken = settings.env?.ANTHROPIC_AUTH_TOKEN;
            const baseUrl = settings.env?.ANTHROPIC_BASE_URL;

            if (authToken && baseUrl) {
                return { authToken, baseUrl };
            }

            return null;
        } catch {
            // If reading fails silently return null
            return null;
        }
    }

    /**
     * Get credentials with debug information
     */
    async getCredentialsWithDebug(): Promise<{ creds: ApiConfig | null; debug: string[] }> {
        const debug: string[] = [];

        // 1. Check Claude Code settings.json
        const claudeSettingsPath = path.join(os.homedir(), '.claude', 'settings.json');
        debug.push(`Claude Code 配置文件: ${claudeSettingsPath}`);

        try {
            if (fs.existsSync(claudeSettingsPath)) {
                const content = fs.readFileSync(claudeSettingsPath, 'utf-8');
                const settings: ClaudeSettings = JSON.parse(content);
                const hasToken = settings.env?.ANTHROPIC_AUTH_TOKEN;
                const hasBaseUrl = settings.env?.ANTHROPIC_BASE_URL;
                debug.push(`✓ 配置文件存在: ANTHROPIC_AUTH_TOKEN=${hasToken ? '已设置' : '未设置'}, ANTHROPIC_BASE_URL=${hasBaseUrl ? '已设置' : '未设置'}`);

                if (hasToken && hasBaseUrl) {
                    const creds = await this.getCredentialsFromClaudeSettings();
                    if (creds) {
                        debug.push('✓ 从 Claude Code 配置文件成功读取凭证');
                        return { creds, debug };
                    }
                }
            } else {
                debug.push('✗ 配置文件不存在');
            }
        } catch (error) {
            debug.push(`✗ 读取配置文件失败: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }

        // 2. Check process environment variables
        const envToken = process.env.ANTHROPIC_AUTH_TOKEN;
        const envBaseUrl = process.env.ANTHROPIC_BASE_URL;
        debug.push(`进程环境变量: ANTHROPIC_AUTH_TOKEN=${envToken ? '已设置 (已隐藏)' : '未设置'}, ANTHROPIC_BASE_URL=${envBaseUrl ? '已设置' : '未设置'}`);

        if (envToken && envBaseUrl) {
            return { creds: { authToken: envToken, baseUrl: envBaseUrl }, debug };
        }

        // 3. Check stored credentials
        const storedToken = await this.secretStorage.get('authToken');
        const storedBaseUrl = this.config.get<string>('baseUrl');
        debug.push(`手动配置的凭证: authToken=${storedToken ? '已设置 (已隐藏)' : '未设置'}, baseUrl=${storedBaseUrl || '未设置'}`);

        if (storedToken && storedBaseUrl) {
            return { creds: { authToken: storedToken, baseUrl: storedBaseUrl }, debug };
        }

        return { creds: null, debug };
    }

    /**
     * Store credentials securely
     */
    async storeCredentials(authToken: string, baseUrl: string): Promise<void> {
        await this.secretStorage.store('authToken', authToken);
        await this.config.update('baseUrl', baseUrl, vscode.ConfigurationTarget.Global);
    }

    /**
     * Clear stored credentials
     */
    async clearCredentials(): Promise<void> {
        await this.secretStorage.delete('authToken');
        await this.config.update('baseUrl', undefined, vscode.ConfigurationTarget.Global);
    }

    /**
     * Check if credentials exist
     */
    async hasCredentials(): Promise<boolean> {
        const creds = await this.getCredentials();
        return creds !== null;
    }
}
