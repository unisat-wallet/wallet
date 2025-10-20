/**
 * Platform adapter interface for platform-specific operations
 */

export interface PlatformInfo {
  name: 'extension' | 'mobile' | 'desktop';
  version: string;
  browser?: string;
  os?: string;
}

export interface TabInfo {
  id: number;
  url: string | undefined;
  title: string | undefined;
  active: boolean;
}

export interface PlatformAdapter {
  /**
   * Get platform information
   */
  getPlatformInfo(): PlatformInfo;
  
  /**
   * Check if feature is supported
   */
  isFeatureSupported(feature: string): boolean;
  
  /**
   * Open URL in new tab/window
   */
  openUrl(url: string): Promise<void>;
  
  /**
   * Get active tab information (extension only)
   */
  getActiveTab?(): Promise<TabInfo | null>;
  
  /**
   * Get all tabs information (extension only)
   */
  getAllTabs?(): Promise<TabInfo[]>;
  
  /**
   * Close tab by id (extension only)
   */
  closeTab?(tabId: number): Promise<void>;
  
  /**
   * Focus tab by id (extension only)
   */
  focusTab?(tabId: number): Promise<void>;
  
  /**
   * Get extension info (extension only)
   */
  getExtensionInfo?(): Promise<{
    id: string;
    version: string;
    name: string;
  }>;
  
  /**
   * Reload extension (extension only)
   */
  reloadExtension?(): Promise<void>;
  
  /**
   * Check if development mode
   */
  isDevelopment(): boolean;
  
  /**
   * Get app version
   */
  getAppVersion(): string;
  
  /**
   * Platform-specific cleanup
   */
  cleanup?(): Promise<void>;
}