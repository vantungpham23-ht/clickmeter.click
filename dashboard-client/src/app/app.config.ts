import { ApplicationConfig, provideZoneChangeDetection, isDevMode } from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { provideClientHydration } from '@angular/platform-browser';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }), 
    provideRouter(routes), 
    provideClientHydration(),
    {
      provide: 'APP_INIT_LOCKS',
      useFactory: () => {
        if (typeof navigator !== 'undefined' && 'locks' in navigator && isDevMode()) {
          (window as any).__LOCK_GUARD__ = true;
        }
        return true;
      }
    }
  ]
};
