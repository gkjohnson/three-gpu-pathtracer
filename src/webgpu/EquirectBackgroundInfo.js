import { Matrix4 } from 'three';
import { sampler, texture, uniform } from 'three/tsl';

export class EquirectBackgroundInfo {

	get map() {

		return this.mapNode.value;

	}

	set map( v ) {

		this.mapNode.value = v;
		this.mapSampler.value = v;

	}

	get blur() {

		return this.blurNode.value;

	}

	set blur( v ) {

		this.blurNode.value = v;

	}

	get rotation() {

		return this.rotationNode.value;

	}

	constructor() {

		this.mapNode = texture( null );
		this.mapSampler = sampler( null );
		this.blurNode = uniform( 0.0 );
		this.rotationNode = uniform( new Matrix4() );

		this._initFns();

	}

	_initFns() {

		// TODO

	}

}
