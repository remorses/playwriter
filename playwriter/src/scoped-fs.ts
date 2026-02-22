import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

/**
 * A sandboxed fs wrapper that restricts all file operations to allowed directories.
 * Any attempt to access files outside the allowed directories will throw an EPERM error.
 *
 * By default, allows access to:
 * - Current working directory (process.cwd())
 * - /tmp
 * - os.tmpdir()
 *
 * This is used in the MCP VM context to prevent agents from accessing sensitive system files.
 */
export class ScopedFS {
  private allowedDirs: string[]

  constructor(allowedDirs?: string[]) {
    // Default allowed directories: cwd, /tmp, os.tmpdir()
    const defaultDirs = [process.cwd(), '/tmp', os.tmpdir()]

    // Use provided dirs or defaults, resolve all to absolute paths
    const dirs = allowedDirs ?? defaultDirs
    this.allowedDirs = [...new Set(dirs.map((d) => path.resolve(d)))]
  }

  /**
   * Check if a resolved path is within any of the allowed directories.
   */
  private isPathAllowed(resolved: string): boolean {
    return this.allowedDirs.some((dir) => {
      return resolved === dir || resolved.startsWith(dir + path.sep)
    })
  }

  /**
   * Resolve a path and ensure it stays within allowed directories.
   * Throws EPERM if the resolved path escapes the sandbox.
   */
  private resolvePath(filePath: string): string {
    // If it's an absolute path, use it directly
    // If it's relative, resolve from cwd
    const resolved = path.resolve(filePath)

    if (!this.isPathAllowed(resolved)) {
      const error = new Error(
        `EPERM: operation not permitted, access outside allowed directories: ${filePath}`,
      ) as NodeJS.ErrnoException
      error.code = 'EPERM'
      error.errno = -1
      error.syscall = 'access'
      error.path = filePath
      throw error
    }
    return resolved
  }

  // Sync methods

  readFileSync = (filePath: fs.PathOrFileDescriptor, options?: any): any => {
    const resolved = this.resolvePath(filePath.toString())
    return fs.readFileSync(resolved, options)
  }

  writeFileSync = (filePath: fs.PathOrFileDescriptor, data: any, options?: any): void => {
    const resolved = this.resolvePath(filePath.toString())
    fs.writeFileSync(resolved, data, options)
  }

  appendFileSync = (filePath: fs.PathOrFileDescriptor, data: any, options?: any): void => {
    const resolved = this.resolvePath(filePath.toString())
    fs.appendFileSync(resolved, data, options)
  }

  readdirSync = (dirPath: fs.PathLike, options?: any): any => {
    const resolved = this.resolvePath(dirPath.toString())
    return fs.readdirSync(resolved, options)
  }

  mkdirSync = (dirPath: fs.PathLike, options?: any): any => {
    const resolved = this.resolvePath(dirPath.toString())
    return fs.mkdirSync(resolved, options)
  }

  rmdirSync = (dirPath: fs.PathLike, options?: any): void => {
    const resolved = this.resolvePath(dirPath.toString())
    fs.rmdirSync(resolved, options)
  }

  unlinkSync = (filePath: fs.PathLike): void => {
    const resolved = this.resolvePath(filePath.toString())
    fs.unlinkSync(resolved)
  }

  statSync = (filePath: fs.PathLike, options?: any): any => {
    const resolved = this.resolvePath(filePath.toString())
    return fs.statSync(resolved, options)
  }

  lstatSync = (filePath: fs.PathLike, options?: any): any => {
    const resolved = this.resolvePath(filePath.toString())
    return fs.lstatSync(resolved, options)
  }

  existsSync = (filePath: fs.PathLike): boolean => {
    try {
      const resolved = this.resolvePath(filePath.toString())
      return fs.existsSync(resolved)
    } catch {
      return false
    }
  }

  accessSync = (filePath: fs.PathLike, mode?: number): void => {
    const resolved = this.resolvePath(filePath.toString())
    fs.accessSync(resolved, mode)
  }

  copyFileSync = (src: fs.PathLike, dest: fs.PathLike, mode?: number): void => {
    const resolvedSrc = this.resolvePath(src.toString())
    const resolvedDest = this.resolvePath(dest.toString())
    fs.copyFileSync(resolvedSrc, resolvedDest, mode)
  }

  renameSync = (oldPath: fs.PathLike, newPath: fs.PathLike): void => {
    const resolvedOld = this.resolvePath(oldPath.toString())
    const resolvedNew = this.resolvePath(newPath.toString())
    fs.renameSync(resolvedOld, resolvedNew)
  }

  chmodSync = (filePath: fs.PathLike, mode: fs.Mode): void => {
    const resolved = this.resolvePath(filePath.toString())
    fs.chmodSync(resolved, mode)
  }

  chownSync = (filePath: fs.PathLike, uid: number, gid: number): void => {
    const resolved = this.resolvePath(filePath.toString())
    fs.chownSync(resolved, uid, gid)
  }

  utimesSync = (filePath: fs.PathLike, atime: fs.TimeLike, mtime: fs.TimeLike): void => {
    const resolved = this.resolvePath(filePath.toString())
    fs.utimesSync(resolved, atime, mtime)
  }

  realpathSync = (filePath: fs.PathLike, options?: any): any => {
    const resolved = this.resolvePath(filePath.toString())
    const real = fs.realpathSync(resolved, options)
    // Verify the real path is also within allowed directories (handles symlinks)
    const realStr = real.toString()
    if (!this.isPathAllowed(realStr)) {
      const error = new Error(
        `EPERM: operation not permitted, realpath escapes allowed directories`,
      ) as NodeJS.ErrnoException
      error.code = 'EPERM'
      throw error
    }
    return real
  }

  readlinkSync = (filePath: fs.PathLike, options?: any): any => {
    const resolved = this.resolvePath(filePath.toString())
    return fs.readlinkSync(resolved, options)
  }

  symlinkSync = (target: fs.PathLike, linkPath: fs.PathLike, type?: fs.symlink.Type | null): void => {
    const resolvedLink = this.resolvePath(linkPath.toString())
    // Target is relative to link location, resolve it to check bounds
    const linkDir = path.dirname(resolvedLink)
    const resolvedTarget = path.resolve(linkDir, target.toString())
    if (!this.isPathAllowed(resolvedTarget)) {
      const error = new Error(
        `EPERM: operation not permitted, symlink target outside allowed directories`,
      ) as NodeJS.ErrnoException
      error.code = 'EPERM'
      throw error
    }
    fs.symlinkSync(target, resolvedLink, type)
  }

  rmSync = (filePath: fs.PathLike, options?: fs.RmOptions): void => {
    const resolved = this.resolvePath(filePath.toString())
    fs.rmSync(resolved, options)
  }

  // Async callback methods

  readFile = (filePath: any, ...args: any[]): void => {
    const resolved = this.resolvePath(filePath.toString())
    ;(fs.readFile as any)(resolved, ...args)
  }

  writeFile = (filePath: any, data: any, ...args: any[]): void => {
    const resolved = this.resolvePath(filePath.toString())
    ;(fs.writeFile as any)(resolved, data, ...args)
  }

  appendFile = (filePath: any, data: any, ...args: any[]): void => {
    const resolved = this.resolvePath(filePath.toString())
    ;(fs.appendFile as any)(resolved, data, ...args)
  }

  readdir = (dirPath: any, ...args: any[]): void => {
    const resolved = this.resolvePath(dirPath.toString())
    ;(fs.readdir as any)(resolved, ...args)
  }

  mkdir = (dirPath: any, ...args: any[]): void => {
    const resolved = this.resolvePath(dirPath.toString())
    ;(fs.mkdir as any)(resolved, ...args)
  }

  rmdir = (dirPath: any, ...args: any[]): void => {
    const resolved = this.resolvePath(dirPath.toString())
    ;(fs.rmdir as any)(resolved, ...args)
  }

  unlink = (filePath: any, callback: any): void => {
    const resolved = this.resolvePath(filePath.toString())
    fs.unlink(resolved, callback)
  }

  stat = (filePath: any, ...args: any[]): void => {
    const resolved = this.resolvePath(filePath.toString())
    ;(fs.stat as any)(resolved, ...args)
  }

  lstat = (filePath: any, ...args: any[]): void => {
    const resolved = this.resolvePath(filePath.toString())
    ;(fs.lstat as any)(resolved, ...args)
  }

  access = (filePath: any, ...args: any[]): void => {
    const resolved = this.resolvePath(filePath.toString())
    ;(fs.access as any)(resolved, ...args)
  }

  copyFile = (src: any, dest: any, ...args: any[]): void => {
    const resolvedSrc = this.resolvePath(src.toString())
    const resolvedDest = this.resolvePath(dest.toString())
    ;(fs.copyFile as any)(resolvedSrc, resolvedDest, ...args)
  }

  rename = (oldPath: any, newPath: any, callback: any): void => {
    const resolvedOld = this.resolvePath(oldPath.toString())
    const resolvedNew = this.resolvePath(newPath.toString())
    fs.rename(resolvedOld, resolvedNew, callback)
  }

  chmod = (filePath: any, mode: any, callback: any): void => {
    const resolved = this.resolvePath(filePath.toString())
    fs.chmod(resolved, mode, callback)
  }

  chown = (filePath: any, uid: any, gid: any, callback: any): void => {
    const resolved = this.resolvePath(filePath.toString())
    fs.chown(resolved, uid, gid, callback)
  }

  rm = (filePath: any, ...args: any[]): void => {
    const resolved = this.resolvePath(filePath.toString())
    ;(fs.rm as any)(resolved, ...args)
  }

  exists = (filePath: any, callback: any): void => {
    try {
      const resolved = this.resolvePath(filePath.toString())
      fs.exists(resolved, callback)
    } catch {
      callback(false)
    }
  }

  // Stream methods

  createReadStream = (filePath: fs.PathLike, options?: any): fs.ReadStream => {
    const resolved = this.resolvePath(filePath.toString())
    return fs.createReadStream(resolved, options)
  }

  createWriteStream = (filePath: fs.PathLike, options?: any): fs.WriteStream => {
    const resolved = this.resolvePath(filePath.toString())
    return fs.createWriteStream(resolved, options)
  }

  // Watch methods

  watch = (filePath: any, ...args: any[]): fs.FSWatcher => {
    const resolved = this.resolvePath(filePath.toString())
    return (fs.watch as any)(resolved, ...args)
  }

  watchFile = (filePath: any, ...args: any[]): fs.StatWatcher => {
    const resolved = this.resolvePath(filePath.toString())
    return (fs.watchFile as any)(resolved, ...args)
  }

  unwatchFile = (filePath: any, listener?: any): void => {
    const resolved = this.resolvePath(filePath.toString())
    fs.unwatchFile(resolved, listener)
  }

  // Promise-based API (fs.promises equivalent)
  get promises() {
    const self = this
    return {
      readFile: async (filePath: fs.PathLike, options?: any) => {
        const resolved = self.resolvePath(filePath.toString())
        return fs.promises.readFile(resolved, options)
      },
      writeFile: async (filePath: fs.PathLike, data: any, options?: any) => {
        const resolved = self.resolvePath(filePath.toString())
        return fs.promises.writeFile(resolved, data, options)
      },
      appendFile: async (filePath: fs.PathLike, data: any, options?: any) => {
        const resolved = self.resolvePath(filePath.toString())
        return fs.promises.appendFile(resolved, data, options)
      },
      readdir: async (dirPath: fs.PathLike, options?: any) => {
        const resolved = self.resolvePath(dirPath.toString())
        return fs.promises.readdir(resolved, options)
      },
      mkdir: async (dirPath: fs.PathLike, options?: any) => {
        const resolved = self.resolvePath(dirPath.toString())
        return fs.promises.mkdir(resolved, options)
      },
      rmdir: async (dirPath: fs.PathLike, options?: any) => {
        const resolved = self.resolvePath(dirPath.toString())
        return fs.promises.rmdir(resolved, options)
      },
      unlink: async (filePath: fs.PathLike) => {
        const resolved = self.resolvePath(filePath.toString())
        return fs.promises.unlink(resolved)
      },
      stat: async (filePath: fs.PathLike, options?: any) => {
        const resolved = self.resolvePath(filePath.toString())
        return fs.promises.stat(resolved, options)
      },
      lstat: async (filePath: fs.PathLike, options?: any) => {
        const resolved = self.resolvePath(filePath.toString())
        return fs.promises.lstat(resolved, options)
      },
      access: async (filePath: fs.PathLike, mode?: number) => {
        const resolved = self.resolvePath(filePath.toString())
        return fs.promises.access(resolved, mode)
      },
      copyFile: async (src: fs.PathLike, dest: fs.PathLike, mode?: number) => {
        const resolved = self.resolvePath(src.toString())
        const resolvedDest = self.resolvePath(dest.toString())
        return fs.promises.copyFile(resolved, resolvedDest, mode)
      },
      rename: async (oldPath: fs.PathLike, newPath: fs.PathLike) => {
        const resolvedOld = self.resolvePath(oldPath.toString())
        const resolvedNew = self.resolvePath(newPath.toString())
        return fs.promises.rename(resolvedOld, resolvedNew)
      },
      chmod: async (filePath: fs.PathLike, mode: fs.Mode) => {
        const resolved = self.resolvePath(filePath.toString())
        return fs.promises.chmod(resolved, mode)
      },
      chown: async (filePath: fs.PathLike, uid: number, gid: number) => {
        const resolved = self.resolvePath(filePath.toString())
        return fs.promises.chown(resolved, uid, gid)
      },
      rm: async (filePath: fs.PathLike, options?: fs.RmOptions) => {
        const resolved = self.resolvePath(filePath.toString())
        return fs.promises.rm(resolved, options)
      },
      realpath: async (filePath: fs.PathLike, options?: any) => {
        const resolved = self.resolvePath(filePath.toString())
        const real = await fs.promises.realpath(resolved, options)
        const realStr = real.toString()
        if (!self.isPathAllowed(realStr)) {
          const error = new Error(
            `EPERM: operation not permitted, realpath escapes allowed directories`,
          ) as NodeJS.ErrnoException
          error.code = 'EPERM'
          throw error
        }
        return real
      },
      readlink: async (filePath: fs.PathLike, options?: any) => {
        const resolved = self.resolvePath(filePath.toString())
        return fs.promises.readlink(resolved, options)
      },
      symlink: async (target: fs.PathLike, linkPath: fs.PathLike, type?: string) => {
        const resolvedLink = self.resolvePath(linkPath.toString())
        const linkDir = path.dirname(resolvedLink)
        const resolvedTarget = path.resolve(linkDir, target.toString())
        if (!self.isPathAllowed(resolvedTarget)) {
          const error = new Error(
            `EPERM: operation not permitted, symlink target outside allowed directories`,
          ) as NodeJS.ErrnoException
          error.code = 'EPERM'
          throw error
        }
        return fs.promises.symlink(target, resolvedLink, type as any)
      },
      utimes: async (filePath: fs.PathLike, atime: fs.TimeLike, mtime: fs.TimeLike) => {
        const resolved = self.resolvePath(filePath.toString())
        return fs.promises.utimes(resolved, atime, mtime)
      },
    }
  }

  // Constants passthrough
  constants = fs.constants
}

/**
 * Create a scoped fs instance with allowed directories.
 * Defaults to cwd, /tmp, and os.tmpdir() if no directories specified.
 */
export function createScopedFS(allowedDirs?: string[]): ScopedFS {
  return new ScopedFS(allowedDirs)
}
