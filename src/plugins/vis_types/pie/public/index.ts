/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { PluginInitializerContext } from '@kbn/core/public';
import { VisTypePiePlugin } from './plugin';
import type { PiePublicConfig } from '../server/config';

export { pieVisType } from './vis_type';
export type { Dimensions, Dimension } from './types';

export const plugin = (initializerContext: PluginInitializerContext<PiePublicConfig>) =>
  new VisTypePiePlugin(initializerContext);
