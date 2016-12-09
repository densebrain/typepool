
import 'jest'

import { Pool, IPoolResourceFactory } from '../ObjectPool'
import { isString } from "typeguard"
import Bluebird from '../PromiseConfig'


const
	factory = {
		create() {
			return Bluebird.resolve('hello')
		},
		destroy(str) {
			return Bluebird.resolve()
		},
		validate(str) {
			return Bluebird.resolve(isString(str))
		}
	} as IPoolResourceFactory<string>

test(`Create pool`,async () => {
	
	const
		pool = new Pool(factory)
	
	expect(await pool.acquire()).toBe('hello')
	
})

test(`Acquire more than max`,async () => {
	
	const
		pool = new Pool(factory,{limit: 1}),
		val1 = await pool.acquire()
	
	expect(val1).toBe('hello')
	
	let
		error = null
	
	try {
		await pool.acquire()
	} catch (err) {
		error  = err
	}
	expect(error).toBeTruthy()
	expect(error.name).toBe('AssertionError')
	
	await pool.release(val1)
	
	const
		val2 = await pool.acquire()
	expect(val2).toBe('hello')
	
	
	return true
	
})
