/** 60-minute soak: the load test with a longer default. Set LT_PID to the server's node PID to track RSS growth. */
process.env.MINUTES ??= '60';
void import('./loadtest');
