import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { LocalStore, postgresStore } from '../apps/api/src/db/store';
import { passwordHash } from '../apps/api/src/services/core';
const email = process.argv[2];
if (!email) {
    console.error('Usage: npm run reset-password -- person@example.com');
    process.exit(1);
}
const rl = createInterface({ input: stdin, output: stdout });
const password = await rl.question('New password (visible in this local terminal): ');
rl.close();
if (password.length < 8)
    throw Error('Password must have at least eight characters.');
const store = process.env.DATABASE_URL ? await postgresStore(process.env.DATABASE_URL) : await new LocalStore(process.env.DATA_FILE || '.data/workspace.json').init();
try {
    const next = await passwordHash(password);
    await store.transaction(s => {
        const u = s.users.find(u => u.email === email.toLowerCase());
        if (!u)
            throw Error('Account not found.');
        u.passwordHash = next;
        for (const [id, session] of Object.entries(s.sessions))
            if (session.userId === u.id)
                delete s.sessions[id];
    });
    console.log('Password changed. Existing sessions were signed out.');
}
finally {
    await store.close();
}
