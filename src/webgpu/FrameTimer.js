/** @import { WebGPURenderer } from 'three/webgpu' */

// Times the gpu work submitted between "begin" and "end", in milliseconds. Uses timestamps written by
// empty passes around the work when the device supports them. Otherwise it times from "begin" until
// the queue drains, which also counts cpu encoding and any work queued earlier.
export class FrameTimer {

	/**
	 * @param {WebGPURenderer} renderer
	 */
	constructor( renderer ) {

		this.renderer = renderer;

		// whether a measurement is in flight. Only one runs at a time.
		this.running = false;

		this._querySet = null;
		this._resolveBuffer = null;
		this._readBuffer = null;
		this._startTime = 0;

	}

	begin() {

		this.running = true;

		const { device } = this.renderer.backend;
		if ( ! device.features.has( 'timestamp-query' ) ) {

			this._startTime = performance.now();
			return;

		}

		if ( ! this._querySet ) {

			this._querySet = device.createQuerySet( { type: 'timestamp', count: 2 } );
			this._resolveBuffer = device.createBuffer( {
				size: 16,
				usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
			} );
			this._readBuffer = device.createBuffer( {
				size: 16,
				usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
			} );

		}

		const encoder = device.createCommandEncoder();
		encoder.beginComputePass( { timestampWrites: { querySet: this._querySet, beginningOfPassWriteIndex: 0 } } ).end();
		device.queue.submit( [ encoder.finish() ] );

	}

	async end() {

		const { device } = this.renderer.backend;
		let time;
		if ( device.features.has( 'timestamp-query' ) ) {

			const { _querySet, _resolveBuffer, _readBuffer } = this;
			const encoder = device.createCommandEncoder();
			encoder.beginComputePass( { timestampWrites: { querySet: _querySet, endOfPassWriteIndex: 1 } } ).end();
			encoder.resolveQuerySet( _querySet, 0, 2, _resolveBuffer, 0 );
			encoder.copyBufferToBuffer( _resolveBuffer, 0, _readBuffer, 0, _readBuffer.size );
			device.queue.submit( [ encoder.finish() ] );

			await _readBuffer.mapAsync( GPUMapMode.READ );
			const [ start, end ] = new BigUint64Array( _readBuffer.getMappedRange() );
			_readBuffer.unmap();

			// timestamps are in nanoseconds and may be quantized, so a tiny frame can read as negative
			time = Math.max( 0, Number( end - start ) / 1e6 );

		} else {

			await device.queue.onSubmittedWorkDone();
			time = performance.now() - this._startTime;

		}

		this.running = false;
		return time;

	}

	dispose() {

		this._querySet?.destroy();
		this._resolveBuffer?.destroy();
		this._readBuffer?.destroy();

	}

}
