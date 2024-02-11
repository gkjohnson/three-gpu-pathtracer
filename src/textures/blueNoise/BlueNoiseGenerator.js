import { shuffleArray, fillWithOnes } from './utils.js';
import { BlueNoiseSamples } from './BlueNoiseSamples.js';

export class BlueNoiseGenerator {

	constructor() {

		this.random = Math.random;
		this.sigma = 1.5;
		this.size = 64;
		this.majorityPointsRatio = 0.1;

		this.samples = new BlueNoiseSamples( 1 );
		this.savedSamples = new BlueNoiseSamples( 1 );

	}

	generate() {

		// http://cv.ulichney.com/papers/1993-void-cluster.pdf

		const {
			samples,
			savedSamples,
			sigma,
			majorityPointsRatio,
			size,
		} = this;

		samples.resize( size );
		samples.setSigma( sigma );

		// 1. Randomly place the minority points.
		const pointCount = Math.floor( size * size * majorityPointsRatio );
		const initialSamples = samples.binaryPattern;

		fillWithOnes( initialSamples, pointCount );
		shuffleArray( initialSamples, this.random );

		for ( let i = 0, l = initialSamples.length; i < l; i ++ ) {

			if ( initialSamples[ i ] === 1 ) {

				samples.addPointIndex( i );

			}

		}

		// 2. Remove minority point that is in densest cluster and place it in the largest void.
		while ( true ) {

			const clusterIndex = samples.findCluster();
			samples.removePointIndex( clusterIndex );

			const voidIndex = samples.findVoid();
			if ( clusterIndex === voidIndex ) {

				samples.addPointIndex( clusterIndex );
				break;

			}

			samples.addPointIndex( voidIndex );

		}

		// 3. PHASE I: Assign a rank to each progressively less dense cluster point and put it
		// in the dither array.
		const ditherArray = new Uint32Array( size * size );
		savedSamples.copy( samples );

		let rank;
		rank = samples.count - 1;
		while ( rank >= 0 ) {

			const clusterIndex = samples.findCluster();
			samples.removePointIndex( clusterIndex );

			ditherArray[ clusterIndex ] = rank;
			rank --;

		}

		// 4. PHASE II: Do the same thing for the largest voids up to half of the total pixels using
		// the initial binary pattern.
		const totalSize = size * size;
		rank = savedSamples.count;
		while ( rank < totalSize / 2 ) {

			const voidIndex = savedSamples.findVoid();
			savedSamples.addPointIndex( voidIndex );
			ditherArray[ voidIndex ] = rank;
			rank ++;

		}

		// 5. PHASE III: Invert the pattern and finish out by assigning a rank to the remaining
		// and iteratively removing them.
		savedSamples.invert();

		while ( rank < totalSize ) {

			const clusterIndex = savedSamples.findCluster();
			savedSamples.removePointIndex( clusterIndex );
			ditherArray[ clusterIndex ] = rank;
			rank ++;

		}

		return { data: ditherArray, maxValue: totalSize };

	}

}
