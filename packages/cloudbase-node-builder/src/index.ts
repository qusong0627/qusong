import path from 'path'
import fs from 'fs-extra'
import archiver from 'archiver'
import nodeFileTrace from '@zeit/node-file-trace'
import { Builder } from '@cloudbase/framework-core'


const __launcher = fs.readFileSync(path.resolve(__dirname, '../asset/__launcher.js'), 'utf-8')

interface NodeBuilderBuildOptions {
    /**
     * 云接入路径
     */
    path: string
}

interface NodeBuilderOptions {
    /**
     * 项目根目录的绝对路径
     */
    projectPath: string
}

export class NodeBuilder extends Builder {
    private dependencies: Object
    constructor(options: NodeBuilderOptions) {
        super({
            type: 'node',
            ...options
        })
        this.dependencies = {
            'express': '^4.17.1',
            'serverless-http': '^2.3.2'
        }
    }
    async build(entry: string, options?: NodeBuilderBuildOptions) {
        const { distDir, projectDir, distDirName } = this
        const entryFile = path.resolve(projectDir, entry)
        const functionName = this.generateFunctionName(entryFile)

        const packageJsonContent = await this.generatePackageJson(functionName)

        // 入口文件的相对路径（相对于项目根路径）
        const entryRelativePath = path.relative(projectDir, path.resolve(projectDir, entryFile));
        await fs.ensureDir(distDir)
        await fs.ensureDir(distDir + '/api')
        await fs.writeFile(path.resolve(distDir, './index.js'), __launcher.replace('/*entryPath*/', entryRelativePath))
        await fs.writeFile(path.resolve(distDir, './package.json'), packageJsonContent)

        const { fileList } = await nodeFileTrace([entryFile], {
            ignore: ['node_modules/**'],
            base: projectDir
        });
        console.log(fileList)
        for (const file of fileList) {
            await fs.copy(path.resolve(projectDir, file), path.join(distDir, './api', file))
        }

        const zipPath = path.resolve(projectDir, `${distDirName}.zip`)
        await this.zipDir(distDir, zipPath)

        return {
            functions: [{
                name: functionName,
                options: {},
                source: zipPath,
                entry: 'index.main'
            }],
            routes: [{
                path: options ? options.path || '/' : '/',
                targetType: 'function',
                target: functionName
            }]
        }
    }

    async zipDir(src: string, dest: string) {
        return new Promise((resolve, reject) => {
            // create a file to stream archive data to.
            var output = fs.createWriteStream(dest);
            var archive = archiver('zip', {
                zlib: { level: 9 } // Sets the compression level.
            });
            output.on('close', resolve)
            archive.on('error', reject)
            archive.directory(src, false)
            archive.pipe(output)
            archive.finalize()
        })
    }

    async generatePackageJson(packageName: string) {
        const { projectDir } = this
        let originalPackageJsonDependencies = {}
        const packageJsonPath = path.resolve(projectDir, 'package.json')
        if (await fs.pathExists(packageJsonPath)) {
            originalPackageJsonDependencies = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8')).dependencies || {}
        }
        const json = {
            name: packageName,
            dependencies: {
                ...this.dependencies,
                ...originalPackageJsonDependencies
            }
        }
        return JSON.stringify(json, null, 4)
    }

    generateFunctionName(entryFile: string) {
        const entryRelativePath = path.relative(this.projectDir, path.resolve(this.projectDir, entryFile));
        const name = entryRelativePath.replace(/\//g, '-').split('.')[0]
        return name
    }
}