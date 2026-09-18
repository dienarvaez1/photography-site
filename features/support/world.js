import { setWorldConstructor, World } from '@cucumber/cucumber';

class SiteWorld extends World {
  constructor(options) {
    super(options);
    // Scratch space step definitions stash data in during a scenario.
    this.data = {};
  }
}

setWorldConstructor(SiteWorld);
