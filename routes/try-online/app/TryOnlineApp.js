'use strict';

require('marko/runtime/dependencies/vdom');

const vfs = require('~/browser-shims/fs');
const vmodules = require('./vmodules');
const readVirtualFiles = require('./readVirtualFiles');
const path = require('path');
const EventEmitter = require('events-light');

const projectNameRegExp = /[/]([a-zA-Z0-9_-]+)([/]|$)/;


class TryOnlineApp extends EventEmitter {
    constructor() {
        super();
        if (typeof readVirtualFiles === 'function') {
            readVirtualFiles(vfs);
        }

        let rootDir = vfs.readTreeSync();


        this.state = {
            rootDir: rootDir,
            activeProject: undefined,
            focusedFile: undefined,
            openFiles: [],
            previewFile: undefined,
            demoPreviewFile: undefined,
            projectPreviewFile: undefined,
            componentPreviewFile: undefined,
            projectLookup: []
        };

        this.assignOpenFilesToPanes();

        vfs.on('file:modified', (file) => {
            vmodules.clearFileCache(file.path);

            if (file.name === 'marko-tag.json' ||
                file.name === 'marko-taglib.json') {

                vmodules.clearCache((filePath) => {
                    if (filePath.endsWith('.marko')) {
                        return true;
                    }
                });
            } else {
                vmodules.clearCache();
            }

            this.emit('file:modified', file);
        });
    }

    loadProjects() {
        let projectLookup = {};
        let projects = [];

        let rootDir = vfs.readTreeSync();

        rootDir.files.forEach((file) => {
            let packageJsonPath = path.join(file.path, 'package.json');
            let description = file.name;
            let name = file.name;

            if (vfs.existsSync(packageJsonPath)) {
                let pkg = vmodules.require(packageJsonPath);
                description = pkg.description || description;
            }

            let previewFile;

            let projectPreviewFilePath = file.path + '/index.marko';
            if (vfs.existsSync(projectPreviewFilePath)) {
                previewFile = vfs.getFile(projectPreviewFilePath);
            }

            let project = {
                name: name,
                description: description,
                rootDir: file,
                previewFile: previewFile
            };

            projectLookup[name] = project;
            projects.push(project);
        });

        this.state.projectLookup = projectLookup;
        this.state.projects = projects;
    }

    initialize(state) {
        function addFiles(dir) {
            dir.files.forEach((file) => {
                if (file.type === 'dir') {
                    addFiles(file);
                } else {
                    vfs.writeFileSync(file.path, file.text);
                }
            });
        }

        addFiles(state.rootDir);

        this.loadProjects();

        this.state.activeProject = this.state.projects[0];
        this.state.focusedDirectory = state.focusedDirectory;
        this.state.focusedFile = state.focusedFile;
        this.state.openFiles = state.openFiles;
    }

    getProjectForPath(filePath) {
        let projectNameMatches = projectNameRegExp.exec(filePath);
        let projectName = projectNameMatches[1];
        return this.state.projectLookup[projectName];
    }

    saveFile(filePath, text) {
        vfs.writeFileSync(filePath, text);
    }

    assignOpenFilesToPanes() {
        let state = this.state;
        let openFiles = state.openFiles;

        let panes = {
            inputTop: [],
            inputBottom: [],
            outputTop: [],
            outputBottom: [],
        };

        if (state.previewFile) {
            let previewFile = Object.create(state.previewFile);
            previewFile.output = true;
            previewFile.outputMode = 'preview';
            panes.outputTop.push(previewFile);
        }

        if (state.demoPreviewFile) {
            let previewFile = Object.create(state.demoPreviewFile);
            previewFile.output = true;
            previewFile.outputMode = 'preview';
            panes.outputTop.push(previewFile);
        }

        if (state.componentPreviewFile) {
            let previewFile = Object.create(state.componentPreviewFile);
            previewFile.output = true;
            previewFile.outputMode = 'compiled';
            panes.outputBottom.push(previewFile);
        }

        if (state.projectPreviewFile) {
            let projectPreviewFile = Object.create(state.projectPreviewFile);
            projectPreviewFile.output = true;
            projectPreviewFile.outputMode = 'preview';
            panes.outputTop.push(projectPreviewFile);
        }

        openFiles.forEach((openFile) => {
            let targetPane;

            if (openFile.name === 'demo.marko') {
                targetPane = 'inputTop';
            } else if (openFile.name === 'index.marko') {
                targetPane = 'inputBottom';
            } else if (openFile.name.endsWith('.marko.js')) {
                targetPane = 'outputTop';
            }

            if (!targetPane) {
                targetPane = 'inputBottom';
            }
            panes[targetPane].push(openFile);
        });

        this.state.panes = panes;
    }

    fileExists(filePath) {
        return vfs.getFile(filePath) !== undefined;
    }

    focusProject(projectName) {
        let project = this.state.projectLookup[projectName];
        this.focusFile(path.join(project.rootDir.path, 'index.marko'));
    }

    focusFile(filePath) {
        let file = vfs.getFile(filePath);
        if (!file) {
            return;
        }

        if (this.state.focusedFile === filePath) {
            return;
        }

        this.state.focusedFile = filePath;

        this.state.activeProject = this.getProjectForPath(filePath);

        let isDirectory = file.isDirectory();
        let dirPath;

        let previouslyFocusedDirectory = this.state.focusedDirectory;

        if (isDirectory) {
            dirPath = filePath;
        } else {
            dirPath = path.dirname(filePath);
        }

        this.state.focusedDirectory = dirPath;

        let dir = vfs.getFile(dirPath);

        let index = {};

        dir.files.forEach((childFile) => {
            index[childFile.name] = childFile;
        });

        let isComponent = 'demo.marko' in index;

        let addOpenFile = (file) => {
            this.state.openFiles.push(file);
        };

        this.state.openFiles = [];
        this.state.projectPreviewFile = undefined;
        this.state.demoPreviewFile = undefined;
        this.state.previewFile = undefined;
        this.state.componentPreviewFile = undefined;

        if (isComponent) {
            if (isDirectory && previouslyFocusedDirectory === dirPath) {
                // We have already opened all of the required files in the
                // directory. Nothing else to do except adjust the focus
                this._emitStateChange();
                return;
            }

            for (let i=0; i<dir.files.length; i++) {
                let curFile = dir.files[i];
                if (curFile.isFile()) {
                    addOpenFile(curFile);

                    if (curFile.name === 'demo.marko') {
                        this.state.demoPreviewFile = index['demo.marko'];
                    } else if (curFile.name === 'index.marko') {
                        this.state.componentPreviewFile = index['index.marko'];
                    }
                }
            }

            this.state.projectPreviewFile = this.state.activeProject.previewFile;
        } else {
            dir.files.forEach((curFile) => {
                if (!curFile.isDirectory() && curFile.name !== 'package.json') {
                    addOpenFile(curFile);
                }

                if (!this.state.projectPreviewFile && path.extname(curFile.path) === '.marko') {
                    this.state.projectPreviewFile = curFile;
                }
            });

            if (!isDirectory) {
                if (path.extname(file.path) === '.marko') {
                    this.state.projectPreviewFile = file;
                }
            }
        }

        this.assignOpenFilesToPanes();

        this._emitStateChange();

        this.emit('focus:change', this.state.focusedFile);
    }

    _emitStateChange() {
        this.emit('state:change', Object.assign({}, this.state));
    }

    onStateChange(callback) {
        this.on('state:change', callback);
    }

    get focusedFile() {
        return this.state.focusedFile;
    }

    get focusedDirectory() {
        return this.state.focusedDirectory;
    }
}


module.exports = TryOnlineApp;
