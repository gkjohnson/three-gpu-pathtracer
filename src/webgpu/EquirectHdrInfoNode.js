import { Matrix3 } from 'three/webgpu';
import { texture, sampler, uniform } from 'three/tsl';
import { EquirectHdrInfoUniform } from '../uniforms/EquirectHdrInfoUniform.js';

// WebGPU node wrapper around EquirectHdrInfoUniform. Exposes the environment map, its
// importance-sampling CDF, and the scalar parameters as TSL nodes so a compute kernel can
// pull them through proxies ( kernel.envInfo.value.mapNode, ...envInfo.value.totalSumNode, etc )
// instead of copying each field onto the kernel by hand.
//
// Node identity is kept stable across updateFrom / parameter changes - only the node values
// are mutated - so swapping the environment does not force a shader rebuild.
export class EquirectHdrInfoNode extends EquirectHdrInfoUniform {

	constructor() {

		super();

		// environment map + importance-sampling CDF textures, each with a sampler
		this.mapNode = texture( this.map );
		this.mapSampler = sampler( this.map );
		this.marginalNode = texture( this.marginalWeights );
		this.marginalSampler = sampler( this.marginalWeights );
		this.conditionalNode = texture( this.conditionalWeights );
		this.conditionalSampler = sampler( this.conditionalWeights );

		// scalar parameters that assemble into the EnvironmentInfo struct in the shader
		this.rotationNode = uniform( new Matrix3() );
		this.intensityNode = uniform( 1 );
		this.blurNode = uniform( 0 );
		this.totalSumNode = uniform( this.totalSum );

	}

	updateFrom( envMap ) {

		super.updateFrom( envMap );

		// refresh values in place on the existing nodes so no rebuild is required
		this.mapNode.value = this.map;
		this.mapSampler.value = this.map;
		this.marginalNode.value = this.marginalWeights;
		this.marginalSampler.value = this.marginalWeights;
		this.conditionalNode.value = this.conditionalWeights;
		this.conditionalSampler.value = this.conditionalWeights;
		this.totalSumNode.value = this.totalSum;

	}

}
