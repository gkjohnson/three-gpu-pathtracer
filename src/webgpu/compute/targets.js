import { ColorManagement, FloatType, RGBAFormat } from 'three';
import { RedIntegerFormat, StorageTexture, UnsignedIntType } from 'three/webgpu';

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
