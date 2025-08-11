import type {Browser} from "puppeteer";
import type {ScriptInfo} from "../types/scriptInfo";
import {scriptResponseHandler} from "../handlers/script";

interface ScriptDetectionArgs {
  browser: Browser;
}

interface IScriptDetectionService {
  getPageScripts(url: string): Promise<ScriptInfo[]>;
}

export class ScriptDetectionService implements IScriptDetectionService {
  private _browser: Browser;

  constructor(args: ScriptDetectionArgs) {
    this._browser = args.browser;
  }

  async getPageScripts(url: string): Promise<ScriptInfo[]> {
    const detectedScripts: ScriptInfo[] = []

    try {
      const page = await this._browser.newPage();
      page.on('response', (response) =>
        scriptResponseHandler(response, detectedScripts),
      )
      await page.goto(url, {waitUntil: 'networkidle0'})
    } catch (e) {
      console.error(`An error occurred during page processing: ${e}`)
    } finally {
      await this._browser.close();
    }

    return detectedScripts;
  }
}
