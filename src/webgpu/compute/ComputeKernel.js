export class ComputeKernel {

	get computeNode() {

		return this.kernel.computeNode;

	}

	constructor( fn, options = {} ) {

		const {
			workgroupSize = [ 64 ],
		} = options;

		this._workGroupSize = [ ...workgroupSize ];
		this._fn = null;
		this.kernel = null;

		this.setFn( fn );

	}

	setFn( fn ) {

		this._fn = fn;
		this.setWorkgroupSize( ...this._workGroupSize );
		return this;

	}

	setWorkgroupSize( x = 64, y = 1, z = 1 ) {

		this._workGroupSize = [ x, y, z ];
		this.kernel = this._fn.computeKernel( [ x, y, z ] );
		return this;

	}

}
