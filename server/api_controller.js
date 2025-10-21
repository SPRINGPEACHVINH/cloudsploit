const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
require("dotenv").config();
const CLOUDSPLOIT_CWD = process.env.CLOUDSPLOIT_CWD;

const generateJsonFilename = (cloud) => {
    const now = new Date(Date.now() + 7 * 60 * 60 * 1000); // UTC+7

    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const day = String(now.getUTCDate()).padStart(2, '0');
    const hours = String(now.getUTCHours()).padStart(2, '0');
    const minutes = String(now.getUTCMinutes()).padStart(2, '0');
    const seconds = String(now.getUTCSeconds()).padStart(2, '0');

    const timestamp = `${year}${month}${day}${hours}${minutes}${seconds}`;
    const dirPath = `./server/scan_result/${year}${month}${day}_${cloud}`;
    console.log('Creating directory path:', dirPath, 'timestamp:', timestamp);
    fs.mkdirSync(dirPath, { recursive: true });
    return `./server/scan_result/${year}${month}${day}_${cloud}/${timestamp}_${cloud}_scan.json`;
};

const createScan = (cloud) => {
    return new Promise((resolve, reject) => {
        try {
            // Validate cloud parameter
            if (cloud === 'azure') {
                return reject({
                    success: false,
                    message: 'Azure scanning is currently under maintenance.',
                    statusCode: 501
                });
            }

            const config = 'config.js';
            const json = generateJsonFilename(cloud);
            console.log('Generated JSON filename:', json);

            // Build command - engine.js will use default plugins
            let command = `node ./index.js --config=./${config} --cloud=${cloud} --console=none --json=${json}`;

            console.log('Executing command:', command);

            // Execute command
            exec(command, {
                cwd: CLOUDSPLOIT_CWD,
                maxBuffer: 10 * 1024 * 1024, // 10MB buffer
                timeout: 300000 // 5 minutes timeout
            }, (error, stdout, stderr) => {
                // Check if scan completed successfully
                const scanComplete = stdout && stdout.includes('Scan complete');
                const jsonWritten = stdout && stdout.includes('JSON file written to');

                if (error) {
                    console.error('Scan execution error:', error);
                    return reject({
                        success: false,
                        message: 'Scan execution failed',
                        error: error.message,
                        code: error.code,
                        output: stdout || null,
                        stderr: stderr || null,
                        statusCode: 500
                    });
                }

                // Check if scan actually completed successfully
                if (!scanComplete) {
                    return reject({
                        success: false,
                        message: 'Scan did not complete successfully',
                        output: stdout || null,
                        stderr: stderr || null,
                        statusCode: 500
                    });
                }

                // Success response
                resolve({
                    success: true,
                    message: 'Scan completed successfully',
                    data: {
                        cloud: cloud,
                        jsonFile: json,
                        timestamp: new Date().toISOString()
                    },
                    output: stdout,
                    warnings: stderr || null,
                    statusCode: 200
                });
            });
        } catch (error) {
            console.error('Error in createScan:', error);
            reject({
                success: false,
                message: 'Failed to create scan',
                error: error.message || 'Unknown error',
                statusCode: 500
            });
        }
    });
};

const handleScanResult = (filePath) => {
    try {
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        const scanData = JSON.parse(fileContent);

        if (!scanData) {
            throw new Error('Scan data is empty or invalid');
        }
        const failedResources = scanData.filter(item => item.status === 'FAIL');

        if (failedResources.length) {
            return {
                success: true,
                failedResources: failedResources,
                message: `${failedResources.length} failed resources found in the scan.`
            };
        }
        else {
            return {
                success: true,
                failedResources: [],
                message: 'No failed resources found in the scan.'
            };
        }
    }
    catch (error) {
        console.error('Error handling scan result:', error);
        throw error;
    }
}

const handleScan = async (req, res) => {
    try {
        const { cloud } = req.body;

        // Validate required parameters
        if (!cloud || (cloud !== 'aws' && cloud !== 'azure')) {
            return res.status(400).json({
                success: false,
                message: 'Invalid request. "cloud" must be either "aws" or "azure".'
            });
        }

        const scanResult = await createScan(cloud);
        if (scanResult.success) {
            const processedResult = handleScanResult(scanResult.data.jsonFile);
            return res.status(200).json({
                success: true,
                message: "Scan completed and processed successfully.",
                data: {
                    cloud: cloud,
                    jsonFile: scanResult.data.jsonFile,
                    timestamp: scanResult.data.timestamp,
                    failedResources: processedResult.failedResources
                }
            });
        }
        else {
            return res.status(400).json({
                success: false,
                message: "Scan failed.",
                error: scanResult.error || null
            });
        }
    }
    catch (error) {
        console.error('Error handling scan request:', error);
        return res.status(500).json({
            message: "Failed to handle scan request.",
            error: error.response
                ? error.response.data
                : error.message || "Unknown error",
        });
    }
};

module.exports = {
    handleScan,
    createScan
};