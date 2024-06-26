/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { FtrProviderContext } from '../../ftr_provider_context';

export default function ({ getService, getPageObjects }: FtrProviderContext) {
  const PageObjects = getPageObjects(['common', 'security']);
  const a11y = getService('a11y');
  const grokDebugger = getService('grokDebugger');

  // Fixes:https://github.com/elastic/kibana/issues/62102
  describe('Dev tools grok debugger', () => {
    before(async () => {
      await PageObjects.common.navigateToApp('grokDebugger');
      await grokDebugger.assertExists();
    });

    it('Dev tools grok debugger set input', async () => {
      await grokDebugger.setEventInput('SegerCommaBob');
      await a11y.testAppSnapshot();
    });

    it('Dev tools grok debugger set pattern', async () => {
      await grokDebugger.setPatternInput('%{USERNAME:u}');
      await a11y.testAppSnapshot();
    });

    it('Dev tools grok debugger simulate', async () => {
      await grokDebugger.clickSimulate();
      await a11y.testAppSnapshot();
    });
  });
}
