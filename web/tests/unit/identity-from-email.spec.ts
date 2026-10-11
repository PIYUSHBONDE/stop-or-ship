import { test, expect } from '@playwright/test';
import { identityFromEmail } from '../../src/features/access/lib/identity';

test('work email derives a display name, organization and plant', () => {
  expect(identityFromEmail('product-owner@example.test')).toEqual({
    display_name: 'Product Owner',
    organization_name: 'Example operations',
    plant_name: 'Example plant',
  });
});
