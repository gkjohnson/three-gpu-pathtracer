export class ComputeKernel {

	get computeNode() {

		return this.kernel.computeNode;

	}

	constructor( fn, options = {} ) {

		const {
			workgroupSize = [ 64 ],
		} = options;

		this.workGroupSize = [ ...workgroupSize ];
		this._fn = null;
		this.kernel = null;

		this.setFn( fn );

	}

	setFn( fn ) {

		this._fn = fn;
		this.setWorkgroupSize( ...this.workGroupSize );
		return this;

	}

	setWorkgroupSize( x = 64, y = 1, z = 1 ) {

		this.workGroupSize = [ x, y, z ];
		this.kernel = this._fn.computeKernel( [ x, y, z ] );
		return this;

	}

	getDispatchSize( tx = 1, ty = 1, tz = 1, target = [] ) {

		const [ wgx, wgy, wgz ] = this.workGroupSize;
		target.length = 3;
		target[ 0 ] = Math.ceil( tx / wgx );
		target[ 1 ] = Math.ceil( ty / wgy );
		target[ 2 ] = Math.ceil( tz / wgz );
		return target;

	}

}
