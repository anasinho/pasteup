#!/usr/bin/env node

/* 
    Deploy pasteup files to S3.
    This script depends on s3cmd configured with appropriate Amazon S3 access credentials. */

var fs       = require('fs'),
    child_pr = require('child_process'),
    mustache = require('mustache'),
    wrench   = require('wrench'),
    async    = require('async');


var s3bucket  = 'pasteup',
    tmp_dir   = '../../deploy_tmp';

var s3_sync_cmd = 's3cmd sync\
                     --recursive\
                     --acl-public\
                     --guess-mime-type\
                    {{#safe_cache}} --add-header "Cache-Control: max-age=60" {{/safe_cache}}\
                    {{#mime}} --mime-type "{{mime}}" {{/mime}}\
                     --add-header "Expires: {{expiry_date}}"\
                      {{directory}} s3://pasteup{{s3dir}}';

function doFullDeploy() {
    copyPasteupTo(tmp_dir);

    sendDeployCommands(true, function() {
        // Finally remove all the temp dirs and exit.
        child_pr.exec('rm -rf ' + tmp_dir, function() {
            process.exit();
        });
    });
}

function doVersionDeploy() {
    copyPasteupTo(tmp_dir);

    sendDeployCommands(false, function() {
        // Finally remove all the temp dirs and exit.
        child_pr.exec('rm -rf ' + tmp_dir, function() {
            process.exit();
        });
    });
}

function sendDeployCommands(full_deploy, callback) {
    var version = getVersionNumber();

    var deploys = [
        function(callback) {
            deploy(
                mustache.to_html(s3_sync_cmd, {
                    'directory': tmp_dir + '/js',
                    's3dir': '/' + version + '/',
                    'expiry_date': getFarFutureExpiryDate(),
                    'safe_cache': true
                }),
                function() { 
                    callback();
                }
            );
        },
        function(callback) {
            deploy(
                mustache.to_html(s3_sync_cmd, {
                    'directory': tmp_dir + '/css',
                    's3dir': '/' + version + '/',
                    'expiry_date': getFarFutureExpiryDate(),
                    'safe_cache': true
                }),
                function() { 
                    callback();
                }
            );
        },
        function(callback) {
            deploy(
                mustache.to_html(s3_sync_cmd, {
                    'directory': '../../versions',
                    's3dir': '/',
                    'expiry_date': getNearFutureExpiryDate(),
                    'mime': 'application/json',
                    'safe_cache': true
                }),
                function() { 
                    callback();
                }
            );
        }
    ];


    if (full_deploy) {
        deploys = deploys.concat(
            function(callback) {
                deploy(
                    mustache.to_html(s3_sync_cmd, {
                        'directory': tmp_dir + '/docs/',
                        's3dir': '/',
                        'expiry_date': getNearFutureExpiryDate(),
                        'safe_cache': true
                    }),
                    function() { 
                        callback();
                    }
                );
            },
            function(callback) {
                deploy(
                    mustache.to_html(s3_sync_cmd, {
                        'directory': tmp_dir + '/js',
                        's3dir': '/',
                        'expiry_date': getNearFutureExpiryDate(),
                        'safe_cache': true
                    }),
                    function() { 
                        callback();
                    }
                );
            },
            function(callback) {
                deploy(
                    mustache.to_html(s3_sync_cmd, {
                        'directory': tmp_dir + '/css',
                        's3dir': '/',
                        'expiry_date': getNearFutureExpiryDate(),
                        'safe_cache': true
                    }),
                    function() { 
                        callback();
                    }
                );
            }
        )
    }

    async.parallel(deploys, function() {
        callback();
    });
    
}

function deploy(command, callback) {
    child_pr.exec(
        command,
        function(error, stdout, stderr) {
            if (error !== null) {
                if (stdout) {
                    throw new Error("Error: " + error);
                }
            }
            if (stdout !== null) {
                process.stdout.write(stdout);
            }
            if (stderr !== null) {
                process.stderr.write(stderr);
                if (stderr.indexOf('s3cmd') > -1) {
                    process.stderr.write('ERROR: Have you installed and configured s3cmd?\n');
                    process.stderr.write('http://s3tools.org/s3cmd\n\n');
                }
            }
            callback();
        }
    );
}

function copyPasteupTo(dest) {
    fs.mkdirSync(dest, '0777');
    wrench.copyDirSyncRecursive('../static/css', dest + '/css');
    wrench.copyDirSyncRecursive('../static/js', dest + '/js');
    wrench.copyDirSyncRecursive('../.', dest + '/docs');
    // Don't copy the build directory to tmp.
    wrench.rmdirSyncRecursive(dest + '/docs/build', false);
    // Static files are already in top level dir.
    wrench.rmdirSyncRecursive(dest + '/docs/static', false);

}

/*
Returns the most recent version number in /version
*/
function getVersionNumber() {
    var f = fs.readFileSync(__dirname  + '/../../versions', 'utf8');
    var data = JSON.parse(f.toString());
    return data['versions'].pop();
}

function getFarFutureExpiryDate() {
    var d = new Date();
    d.setYear(d.getFullYear() + 10);
    return d.toGMTString();
}

function getNearFutureExpiryDate() {
    var d = new Date();
    d.setMinutes(d.getMinutes() + 1)
    return d.toGMTString();
}

if (!module.parent) {
    var deploy_type_arg = process.argv[2],
        full_flag = '--full',
        version_flag = '--version';
    
    // Check that a deploy type argument has been specified.
    if (deploy_type_arg === full_flag || deploy_type_arg === version_flag) {

        // Check the build number we're about to deploy
        process.stdout.write('\nYou are deploying version: ' + getVersionNumber());
        process.stdout.write('\nIs this the correct version number? (y/n)\n');
        var stdin = process.openStdin();
        stdin.setEncoding('utf8');
        stdin.once('data', function(val) {
            if (val.trim() === 'y') {
                if (deploy_type_arg === full_flag) {
                    doFullDeploy();
                } else {
                    doVersionDeploy();
                }
                //doDeploy();
            } else {
                process.stdout.write("\nSo update the version number in ../../version\n\n");
                process.exit();
            }
        }).resume();

    } else {
        process.stdout.write('Error: Choose full or version deploy with --full, or --version argument.\n\n');
        process.exit();
    }

}