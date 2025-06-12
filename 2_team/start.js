import { spawn } from 'child_process';
import { default as config } from "./config.js";

const master = { id: config.master.id, role: 'master', token: config.master.token, dashboard_port: config.master.dashboard_port };

const slave = { id: config.slave.id, role: 'slave', token: config.slave.token, dashboard_port: config.slave.dashboard_port };

// Start the processes
spawnProcesses( master, slave ); // I am master and team mate is slave
spawnProcesses( slave, master ); // I am slave and team mate is master

// Function to spawn child processes
function spawnProcesses( me, teamMate ) {
    
    // master e083aa6f59e
    const childProcess = spawn(
        `node main \
        host="${config.host}" \
        token="${me.token}" \
        buddyId="${teamMate.id}" \
        role="${me.role}" \
        port="${me.dashboard_port}" `,
        { shell: true }
    );

    childProcess.stdout.on('data', data => {
        console.log(me.role, '>', data.toString());
    });

    childProcess.stderr.on('data', data => {
        console.error(me.role, '>', data.toString());
    });

    childProcess.on('close', code => {
        console.log(`${me.role}: exited with code ${code}`);
    });

};


