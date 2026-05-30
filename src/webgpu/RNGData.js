import { proxyFn } from './lib/nodes/NodeProxy';

export class RNGData {

	constructor() {

		this.init = proxyFn( 'fns.init', this );
		this.nextBounce = proxyFn( 'fns.nextBounce', this );
		this.f32 = proxyFn( 'fns.f32', this );
		this.vec2f = proxyFn( 'fns.vec2f', this );
		this.vec3f = proxyFn( 'fns.vec3f', this );
		this.vec4f = proxyFn( 'fns.vec4f', this );

	}

	setFunctions( fns ) {

		this.fns = fns;

	}

}
