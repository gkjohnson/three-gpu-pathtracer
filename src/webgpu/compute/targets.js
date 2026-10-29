import { ColorManagement, FloatType, NearestFilter, RGBAFormat } from 'three';
import { RedIntegerFormat, StorageArrayTexture, StorageTexture, UnsignedIntType } from 'three/webgpu';
import { AUX_LAYERS } from '../nodes/aux.wgsl.js';

// The storage textures the backends accumulate into. The kernels are created with these too, so
// their pipelines are compiled against the formats they are dispatched with.

// the color accumulation, in the working color space
export function createOutputTarget( name = '' ) {

	const target = new StorageTexture( 1, 1 );
	target.format = RGBAFormat;
	target.type = FloatType;
	target.colorSpace = ColorManagement.workingColorSpace;
	target.name = name;
	target.generateMipmaps = false;
	return target;

}

// the per pixel sample count and its flags
export function createSampleCountTarget( name = '' ) {

	const target = new StorageTexture( 1, 1 );
	target.format = RedIntegerFormat;
	target.type = UnsignedIntType;
	target.name = name;
	target.generateMipmaps = false;
	return target;

}

// the denoiser's first hit albedo and normal, packed as halves into the layers. See "aux.wgsl.js"
export function createAuxTarget( name = '' ) {

	const target = new StorageArrayTexture( 1, 1, AUX_LAYERS );
	target.format = RedIntegerFormat;
	target.type = UnsignedIntType;
	target.minFilter = NearestFilter;
	target.magFilter = NearestFilter;
	target.name = name;
	target.generateMipmaps = false;
	return target;

}
