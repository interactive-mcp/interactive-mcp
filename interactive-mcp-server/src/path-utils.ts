import * as path from 'path';
import * as fs from 'fs';

/**
 * Cross-platform path normalization utilities for workspace identification
 */

/**
 * Normalizes a workspace path for consistent cross-platform comparison
 * @param workspacePath - The workspace path to normalize
 * @returns Normalized path string
 */
export function normalizeWorkspacePath(workspacePath: string): string {
  if (!workspacePath) {
    return '';
  }

  try {
    // Resolve to absolute path and normalize separators
    let normalized = path.resolve(workspacePath);
    
    // Convert to forward slashes for consistency
    normalized = normalized.replace(/\\/g, '/');
    
    // Convert Windows drive letters to lowercase for consistency
    if (process.platform === 'win32' && normalized.match(/^[A-Z]:/)) {
      normalized = normalized.charAt(0).toLowerCase() + normalized.slice(1);
    }
    
    // Try to resolve symlinks to ensure matching
    try {
      const realPath = fs.realpathSync(normalized);
      normalized = realPath.replace(/\\/g, '/');
      if (process.platform === 'win32' && normalized.match(/^[A-Z]:/)) {
        normalized = normalized.charAt(0).toLowerCase() + normalized.slice(1);
      }
    } catch (error) {
      // If realpath fails (e.g., path doesn't exist), use the normalized version
      // This is fine since we're just using it for matching
    }
    
    // Remove trailing slash for consistency
    if (normalized.length > 1 && normalized.endsWith('/')) {
      normalized = normalized.slice(0, -1);
    }
    
    return normalized;
  } catch (error) {
    console.warn(`Failed to normalize path "${workspacePath}":`, error);
    // Fallback: basic normalization
    return workspacePath.replace(/\\/g, '/').toLowerCase();
  }
}

/**
 * Checks if two workspace paths refer to the same location
 * @param path1 - First workspace path
 * @param path2 - Second workspace path  
 * @returns True if paths refer to the same location
 */
export function areWorkspacePathsEqual(path1: string, path2: string): boolean {
  const normalized1 = normalizeWorkspacePath(path1);
  const normalized2 = normalizeWorkspacePath(path2);
  return normalized1 === normalized2;
}

/**
 * Checks if two workspace paths are related (exact match or parent-child relationship)
 * This is more flexible for workspace coordination when paths don't match exactly
 * @param path1 - First workspace path
 * @param path2 - Second workspace path  
 * @returns True if paths are related (same or one is parent of other)
 */
export function areWorkspacePathsRelated(path1: string, path2: string): boolean {
  const normalized1 = normalizeWorkspacePath(path1);
  const normalized2 = normalizeWorkspacePath(path2);
  
  // Exact match
  if (normalized1 === normalized2) {
    return true;
  }
  
  // Check if one is a parent of the other
  const shorter = normalized1.length < normalized2.length ? normalized1 : normalized2;
  const longer = normalized1.length < normalized2.length ? normalized2 : normalized1;
  
  // Check if shorter path is a parent of longer path
  return longer.startsWith(shorter + '/');
}

/**
 * Gets the current working directory normalized for workspace identification
 * @returns Normalized current working directory
 */
export function getCurrentWorkspacePath(): string {
  return normalizeWorkspacePath(process.cwd());
}

/**
 * Extracts a workspace identifier from a VS Code context
 * Tries multiple methods to identify the workspace
 * @param vscodeWorkspaceInfo - Object containing VS Code workspace information
 * @returns Normalized workspace path or fallback identifier
 */
export function extractWorkspaceId(vscodeWorkspaceInfo: {
  workspaceFolders?: Array<{ uri: { fsPath: string } }>;
  workspaceFile?: { fsPath: string };
  rootPath?: string;
}): string {
  // Try workspace folders first (multi-root workspace)
  if (vscodeWorkspaceInfo.workspaceFolders && vscodeWorkspaceInfo.workspaceFolders.length > 0) {
    // Use the first workspace folder as the primary identifier
    return normalizeWorkspacePath(vscodeWorkspaceInfo.workspaceFolders[0].uri.fsPath);
  }
  
  // Try workspace file (saved workspace)
  if (vscodeWorkspaceInfo.workspaceFile) {
    return normalizeWorkspacePath(vscodeWorkspaceInfo.workspaceFile.fsPath);
  }
  
  // Fallback to root path (single folder workspace)
  if (vscodeWorkspaceInfo.rootPath) {
    return normalizeWorkspacePath(vscodeWorkspaceInfo.rootPath);
  }
  
  // Ultimate fallback - use current directory
  return getCurrentWorkspacePath();
}

/**
 * Generates a unique session identifier for cases where workspace path isn't available
 * @returns Unique session identifier
 */
export function generateSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}