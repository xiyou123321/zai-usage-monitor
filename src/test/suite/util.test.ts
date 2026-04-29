import assert from 'assert';
import {
    formatDateTime,
    getNextMonthlyResetTime,
    getTimeWindowParams,
    getUsageRangeLabel,
} from '../../util/timeWindow';

suite('Time Window Tests', () => {
    test('calculates today time window', () => {
        const mockDate = new Date(2026, 3, 1, 14, 30, 0);
        const result = getTimeWindowParams('today', mockDate);

        assert.strictEqual(result.startTime, '2026-04-01 00:00:00');
        assert.strictEqual(result.endTime, '2026-04-01 23:59:59');
    });

    test('calculates last 7 days time window', () => {
        const mockDate = new Date(2026, 3, 10, 8, 15, 0);
        const result = getTimeWindowParams('last7Days', mockDate);

        assert.strictEqual(result.startTime, '2026-04-04 00:00:00');
        assert.strictEqual(result.endTime, '2026-04-10 23:59:59');
    });

    test('calculates next monthly reset time', () => {
        const mockDate = new Date(2026, 3, 10, 8, 15, 0);
        const result = getNextMonthlyResetTime(mockDate);

        assert.strictEqual(result, new Date(2026, 4, 1, 0, 0, 0, 0).toISOString());
    });

    test('returns chinese range labels', () => {
        assert.strictEqual(getUsageRangeLabel('today'), '当天');
        assert.strictEqual(getUsageRangeLabel('last7Days'), '最近 7 天');
    });

    test('formats datetime using local clock format required by official script', () => {
        const mockDate = new Date(2026, 3, 10, 8, 5, 9);

        assert.strictEqual(formatDateTime(mockDate), '2026-04-10 08:05:09');
    });
});
